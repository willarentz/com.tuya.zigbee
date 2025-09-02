'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER, Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');

Cluster.addCluster(TuyaSpecificCluster);

class motion_temp_humid_lux_sensor extends ZigBeeDevice {

	async onNodeInit({ zclNode }) {

		this.printNode();

		if (this.isFirstInit()){
			this.log('TS0601 device detected - using Tuya datapoints only');
		}

		// Tuya specific cluster handlers - PRIMARY data source for TS0601 devices
		if (zclNode.endpoints[1].clusters.tuya) {
			zclNode.endpoints[1].clusters.tuya.on("reporting", value => this.processResponse(value));
			zclNode.endpoints[1].clusters.tuya.on("response", value => this.processResponse(value));
			this.log('Tuya cluster handlers registered');
		} else {
			this.log('WARNING: No Tuya cluster found - device may not function properly');
		}

		// Add fallback support for standard Zigbee temperature/humidity clusters
		// Some TS0601 devices may report temperature/humidity via standard clusters
		try {
			if (zclNode.endpoints[1].clusters.temperatureMeasurement) {
				this.log('Standard temperature cluster registered');
				zclNode.endpoints[1].clusters.temperatureMeasurement.on('attr.measuredValue', (measuredValue) => {
					const temperature = measuredValue / 100;
					const temperatureOffset = this.getSetting('temperature_offset') || 0;
					this.log('Standard temperature:', temperature + temperatureOffset, '°C');
					this.setCapabilityValue('measure_temperature', temperature + temperatureOffset).catch(this.error);
				});
			}
		} catch (error) {
			this.log('Temperature cluster unavailable');
		}

		try {
			if (zclNode.endpoints[1].clusters.relativeHumidity) {
				this.log('Standard humidity cluster registered');
				zclNode.endpoints[1].clusters.relativeHumidity.on('attr.measuredValue', (measuredValue) => {
					const humidity = measuredValue / 100;
					const humidityOffset = this.getSetting('humidity_offset') || 0;
					this.log('Standard humidity:', humidity + humidityOffset, '%');
					this.setCapabilityValue('measure_humidity', humidity + humidityOffset).catch(this.error);
				});
			}
		} catch (error) {
			this.log('Humidity cluster unavailable');
		}

		// Add support for standard Zigbee power configuration cluster for battery
		try {
			if (zclNode.endpoints[1].clusters.powerConfiguration) {
				this.log('Standard power cluster registered');
				zclNode.endpoints[1].clusters.powerConfiguration.on('attr.batteryPercentageRemaining', (batteryPercentage) => {
					const batteryLevel = batteryPercentage / 2;
					this.log('Standard battery:', batteryLevel, '%');
					this.setCapabilityValue('measure_battery', batteryLevel).catch(this.error);
					const batteryThreshold = this.getSetting('batteryThreshold') || 20;
					this.setCapabilityValue('alarm_battery', batteryLevel < batteryThreshold).catch(this.error);
				});
			}
		} catch (error) {
			this.log('Power cluster unavailable');
		}
	}


	// Process Tuya-specific data - main data source for TS0601 devices
	processResponse(data) {
		if (data && data.dp !== undefined) {
			switch (data.dp) {
				case 1: // Motion detection datapoint (radar sensor)
					if (data.datatype === 4) {
						const motionDetected = data.data && data.data[0] === 1;
						this.log('Motion DP1:', motionDetected);
						this.setCapabilityValue('alarm_motion', motionDetected).catch(this.error);
					}
					break;
				case 101: // Humidity datapoint
					if (data.datatype === 2) {
						const humidity = data.data ? data.data[3] : 0;
						const humidityOffset = this.getSetting('humidity_offset') || 0;
						this.log('Humidity DP101:', humidity + humidityOffset, '%');
						this.setCapabilityValue('measure_humidity', humidity + humidityOffset).catch(this.error);
					}
					break;
				case 106: // Luminance datapoint
					if (data.datatype === 2) {
						const luxValue = data.data ? (data.data[2] << 8) | data.data[3] : 0;
						this.log('Luminance DP106:', luxValue, 'lux');
						this.setCapabilityValue('measure_luminance', luxValue).catch(this.error);
					}
					break;
				case 111: // Temperature datapoint
					if (data.datatype === 2) {
						let rawTemp = data.data ? (data.data[0] << 24) | (data.data[1] << 16) | (data.data[2] << 8) | data.data[3] : 0;
						if (rawTemp > 0x7FFFFFFF) {
							rawTemp = rawTemp - 0x100000000;
						}
						const tempValue = rawTemp / 10;
						const temperatureOffset = this.getSetting('temperature_offset') || 0;
						this.log('Temperature DP111:', tempValue + temperatureOffset, '°C');
						this.setCapabilityValue('measure_temperature', tempValue + temperatureOffset).catch(this.error);
					}
					break;
				case 110: // Battery percentage datapoint  
					if (data.datatype === 2) {
						const batteryLevel = data.data ? data.data[3] : 0;
						if (batteryLevel >= 0 && batteryLevel <= 100) {
							this.log('*** BATTERY DP110 (%):', batteryLevel, 'raw:', data.data);
							this.setCapabilityValue('measure_battery', batteryLevel).catch(this.error);
							const batteryThreshold = this.getSetting('batteryThreshold') || 20;
							this.setCapabilityValue('alarm_battery', batteryLevel < batteryThreshold).catch(this.error);
						} else {
							this.log('DP110 invalid battery value:', batteryLevel, 'raw:', data.data);
						}
					}
					break;
				default:
					this.log('Unknown datapoint DP' + data.dp + ':', data.datatype, data.data);
			}
		} else {
			this.log('Tuya response missing DP:', data);
		}
	}
  		
	// Handle device removal
	onDeleted() {
		this.log('Motion Temperature Humidity Luminance Sensor removed');
	}

}

module.exports = motion_temp_humid_lux_sensor;
