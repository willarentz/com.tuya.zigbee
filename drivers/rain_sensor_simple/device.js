'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class RainSensorSimple extends ZigBeeDevice {

  async onNodeInit({ zclNode }) {
    
    this.printNode();

    if (this.isFirstInit()) {
      this.log('Simple Rain Sensor (_TZ3000_otwpdq1d) detected');
    }

    // Handle IAS Zone enrollment and status changes for rain detection
    try {
      const iasZoneCluster = zclNode.endpoints[1].clusters[CLUSTER.IAS_ZONE.NAME];
      
      if (iasZoneCluster) {
        this.log('IAS Zone cluster found - setting up enrollment and status handlers');
        
        // Handle zone status change notifications (rain detection)
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

    // Initialize battery to 100% for fresh batteries (this device doesn't report actual percentage)
    this.setCapabilityValue('measure_battery', 100).catch(this.error);
    this.setCapabilityValue('alarm_battery', false).catch(this.error);
    
    this.log('Battery initialized to 100% - this device only reports low battery warnings via IAS Zone');
  }

  // Handle IAS Zone status changes (rain detection events)
  onIASZoneStatusChangeNotification({ zoneStatus, extendedStatus, zoneId, delay }) {
    this.log('Simple Rain Sensor IAS Zone Status Change:', {
      zoneStatus,
      extendedStatus, 
      zoneId,
      delay,
      alarm1: zoneStatus.alarm1,
      battery: zoneStatus.battery
    });

    // Update water alarm (rain detected/not detected)
    this.setCapabilityValue('alarm_water', zoneStatus.alarm1).catch(this.error);
    
    // Handle battery status from IAS Zone cluster
    if (typeof zoneStatus.battery === 'boolean') {
      this.log('Battery status from IAS Zone:', zoneStatus.battery ? 'LOW' : 'OK');
      this.setCapabilityValue('alarm_battery', zoneStatus.battery).catch(this.error);
      
      // Update battery percentage based on low battery warning
      if (zoneStatus.battery) {
        // Low battery detected
        this.setCapabilityValue('measure_battery', 15).catch(this.error);
        this.log('Battery level updated to 15% due to low battery warning');
      } else {
        // Battery OK - only update if currently showing low battery
        const currentBattery = this.getCapabilityValue('measure_battery');
        if (currentBattery < 50) {
          this.setCapabilityValue('measure_battery', 100).catch(this.error);
          this.log('Battery level restored to 100% - low battery warning cleared');
        }
      }
    }
    
    // Check if there are any other battery-related fields in extendedStatus
    if (extendedStatus) {
      this.log('Extended status received:', extendedStatus);
    }
  }

  // Handle zone enrollment requests from the device
  async onZoneEnrollRequest({ zoneType, manufacturerCode }) {
    this.log('Simple Rain Sensor Zone Enrollment Request:', { zoneType, manufacturerCode });
    
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
    this.log('Simple Rain Sensor removed');
  }
}

module.exports = RainSensorSimple;
