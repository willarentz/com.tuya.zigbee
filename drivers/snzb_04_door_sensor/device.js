'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class SnzbDoorSensor extends ZigBeeDevice {

  async onNodeInit({ zclNode }) {
    
    this.printNode();

    if (this.isFirstInit()) {
      this.log('SNZB-04 eWeLink Door/Window Sensor detected');
    }

    // Handle IAS Zone enrollment and status changes
    try {
      const iasZoneCluster = zclNode.endpoints[1].clusters[CLUSTER.IAS_ZONE.NAME];
      
      if (iasZoneCluster) {
        this.log('IAS Zone cluster found - setting up enrollment and status handlers');
        
        // Handle zone status change notifications (door open/close)
        iasZoneCluster.onZoneStatusChangeNotification = payload => {
          this.onIASZoneStatusChangeNotification(payload);
        };

        // Handle zone enrollment requests from device
        iasZoneCluster.onZoneEnrollRequest = payload => {
          this.onZoneEnrollRequest(payload);
        };

        this.log('IAS Zone handlers registered successfully');
        
        // Try to enroll the zone if not already enrolled
        try {
          await this.enrollIASZone();
        } catch (error) {
          this.log('Zone enrollment will be handled during device initialization:', error.message);
        }
        
      } else {
        this.log('WARNING: IAS Zone cluster not found');
      }
    } catch (error) {
      this.error('Failed to setup IAS Zone cluster:', error);
    }

    // Handle battery reporting from power configuration cluster
    try {
      const powerCluster = zclNode.endpoints[1].clusters[CLUSTER.POWER_CONFIGURATION.NAME];
      if (powerCluster) {
        this.log('Power configuration cluster registered');
        powerCluster.on('attr.batteryPercentageRemaining', (batteryPercentage) => {
          const batteryLevel = batteryPercentage / 2;
          this.log('Battery level:', batteryLevel, '%');
          this.setCapabilityValue('measure_battery', batteryLevel).catch(this.error);
          
          const batteryThreshold = this.getSetting('batteryThreshold') || 20;
          this.setCapabilityValue('alarm_battery', batteryLevel < batteryThreshold).catch(this.error);
        });
      }
    } catch (error) {
      this.log('Power configuration cluster unavailable');
    }
  }

  // Handle IAS Zone status changes (door open/close events)
  onIASZoneStatusChangeNotification({ zoneStatus, extendedStatus, zoneId, delay }) {
    this.log('SNZB-04 IAS Zone Status Change:', {
      zoneStatus,
      extendedStatus, 
      zoneId,
      delay,
      alarm1: zoneStatus.alarm1,
      battery: zoneStatus.battery
    });

    // Update contact alarm (door/window open/closed)
    this.setCapabilityValue('alarm_contact', zoneStatus.alarm1).catch(this.error);
    
    // Update battery alarm if battery status is reported
    if (typeof zoneStatus.battery === 'boolean') {
      this.setCapabilityValue('alarm_battery', zoneStatus.battery).catch(this.error);
    }
  }

  // Handle zone enrollment requests from the device
  async onZoneEnrollRequest({ zoneType, manufacturerCode }) {
    this.log('SNZB-04 Zone Enrollment Request:', { zoneType, manufacturerCode });
    
    try {
      // Respond to enrollment request
      await this.enrollIASZone();
      this.log('Zone enrollment response sent successfully');
    } catch (error) {
      this.error('Failed to respond to zone enrollment request:', error);
    }
  }

  // Enroll the IAS Zone
  async enrollIASZone() {
    try {
      const endpoint = this.zclNode.endpoints[1];
      const iasZoneCluster = endpoint.clusters[CLUSTER.IAS_ZONE.NAME];
      
      if (!iasZoneCluster) {
        throw new Error('IAS Zone cluster not available');
      }

      // Send zone enrollment response
      await iasZoneCluster.zoneEnrollResponse({
        enrollResponseCode: 0, // Success
        zoneId: 0 // Zone ID
      });
      
      this.log('IAS Zone enrollment completed successfully');
      
    } catch (error) {
      this.error('IAS Zone enrollment failed:', error);
      throw error;
    }
  }

  // Handle device removal
  onDeleted() {
    this.log('SNZB-04 Door/Window Sensor removed');
  }
}

module.exports = SnzbDoorSensor;
