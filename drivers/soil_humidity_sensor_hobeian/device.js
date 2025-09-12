'use strict';

const { Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');
const TuyaSpecificClusterDevice = require('../../lib/TuyaSpecificClusterDevice');
const { getDataValue } = require('../../lib/TuyaHelpers');
const { V1_SOIL_SENSOR_DATA_POINTS, V1_TEMPHUMID_SENSOR_DATA_POINTS } = require('../../lib/TuyaDataPoints');

Cluster.addCluster(TuyaSpecificCluster);

class SoilHumiditySensorHobeian extends TuyaSpecificClusterDevice {

  async onNodeInit({ zclNode }) {

    this.printNode();

    // Attach event listeners to handle incoming data from Tuya clusters
    zclNode.endpoints[1].clusters.tuya.on("reporting", this.processDatapoint.bind(this));
    zclNode.endpoints[1].clusters.tuya.on("response", this.processDatapoint.bind(this));
    zclNode.endpoints[1].clusters.tuya.on("reportingConfiguration", this.processDatapoint.bind(this));

    // Read basic device attributes
    await zclNode.endpoints[1].clusters.basic.readAttributes(['manufacturerName', 'zclVersion', 'appVersion', 'modelId', 'powerSource', 'attributeReportingStatus'])
    .catch(err => {
        this.error('Error when reading device attributes ', err);
    });
  }

  async processDatapoint(data) {
    const dp = data.dp;
    const parsedValue = getDataValue(data);
    const dataType = data.datatype;
    // this.log(`Processing DP ${dp}, Data Type: ${dataType}, Parsed Value:`, parsedValue);

    // Log all received data points for debugging
    // this.log(`HOBEIAN ZG-303Z - Received DP ${dp} with value ${parsedValue} (datatype: ${dataType})`);

    switch (dp) {
      case 3: // soil_moisture
        this.log('DP 3 - Soil moisture:', parsedValue);
        this.setCapabilityValue('soil_moisture', parsedValue).catch(this.error);
        break;

      case 5: // temperature
        this.log('DP 5 - Temperature:', parsedValue);
        this.setCapabilityValue('measure_temperature', parsedValue / 10).catch(this.error);
        break;

      case 9: // temperature_unit
        // this.log('DP 9 - Temperature unit:', parsedValue);
        // 0: Celsius, 1: Fahrenheit - could be used for future unit conversion
        break;

      case 15: // battery
        this.log('DP 15 - Battery percentage:', parsedValue);
        this.setCapabilityValue('measure_battery', parsedValue).catch(this.error);
        // Set battery alarm based on threshold (e.g., < 20%)
        const batteryThreshold = this.getSetting('batteryThreshold') || 20;
        this.setCapabilityValue('alarm_battery', parsedValue < batteryThreshold).catch(this.error);
        break;

      case 102: // soil_calibration
        // this.log('DP 102 - Soil moisture calibration:', parsedValue);
        // Calibration value - could be stored as setting if needed
        break;

      case 104: // temperature_calibration
        // this.log('DP 104 - Temperature calibration:', parsedValue);
        // Temperature calibration value
        break;

      case 105: // humidity_calibration
        // this.log('DP 105 - Humidity calibration:', parsedValue);
        // Humidity calibration value
        break;

      case 106: // water_warning
        this.log('DP 106 - Water warning:', parsedValue);
        this.setCapabilityValue('alarm_water', parsedValue).catch(this.error);
        break;

      case 109: // humidity
        this.log('DP 109 - Air humidity:', parsedValue);
        this.setCapabilityValue('measure_humidity', parsedValue).catch(this.error);
        break;

      case 110: // soil_warning (threshold %)
        // this.log('DP 110 - Soil warning threshold:', parsedValue);
        // Soil moisture warning threshold - could trigger additional logic
        break;

      case 111: // temperature_sampling
        // this.log('DP 111 - Temperature sampling interval (minutes):', parsedValue);
        // Temperature sampling interval
        break;

      case 112: // soil_sampling
        // this.log('DP 112 - Soil sampling interval (minutes):', parsedValue);
        // Soil sampling interval
        break;

      default:
        this.log('Unhandled DP:', dp, 'with value:', parsedValue);
    }
  }

  onDeleted() {
    this.log("HOBEIAN soil humidity sensor removed");
  }

}

module.exports = SoilHumiditySensorHobeian;
