'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER, Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');
const IASZoneBoundCluster = require('../../lib/IASZoneBoundCluster');

Cluster.addCluster(TuyaSpecificCluster);

class motion_sensor_2 extends ZigBeeDevice {

	async onNodeInit({ zclNode }) {

		this.printNode();

		if (this.isFirstInit()){
			// Set IAS CIE Address to enable enrollment
			try {
				const homeyAddress = await this.homey.zigbee.getCoordinatorAddress();
				await zclNode.endpoints[1].clusters[CLUSTER.IAS_ZONE.NAME].writeAttributes({
					iasCIEAddress: homeyAddress
				});
				this.log('IAS CIE Address set to:', homeyAddress);
			} catch (error) {
				this.error('Failed to set IAS CIE Address:', error);
			}

			await this.configureAttributeReporting([
				{
					endpointId: 1,
					cluster: CLUSTER.IAS_ZONE,
					attributeName: 'zoneStatus',
                    minInterval: 5, // Minimum interval between reports (seconds)
                    maxInterval: 3600, // Maximum interval (1 hour)
                    minChange: 0, // Report any change
				},{
					endpointId: 1,
					cluster: CLUSTER.POWER_CONFIGURATION,
					attributeName: 'batteryPercentageRemaining',
                    minInterval: 60, // Minimum interval (1 minute)
                    maxInterval: 21600, // Maximum interval (6 hours)
                    minChange: 1, // Report changes greater than 1%
				},{
					endpointId: 1,
					cluster: CLUSTER.ILLUMINANCE_MEASUREMENT,
					attributeName: 'measuredValue',
                    minInterval: 60, // Minimum interval (1 minute)
                    maxInterval: 3600, // Maximum interval (1 hour)
                    minChange: 10, // Report changes above 10 lux
				}
			]).catch(this.error);
		}

        // alarm_motion handler
		zclNode.endpoints[1].clusters[CLUSTER.IAS_ZONE.NAME]
		.on('attr.zoneStatus', this.onZoneStatusAttributeReport.bind(this));

        // measure_battery and alarm_battery handler
		zclNode.endpoints[1].clusters[CLUSTER.POWER_CONFIGURATION.NAME]
		.on('attr.batteryPercentageRemaining', this.onBatteryPercentageRemainingAttributeReport.bind(this));
		
        // measure_luminance handler
		zclNode.endpoints[1].clusters[CLUSTER.ILLUMINANCE_MEASUREMENT.NAME]
		.on('attr.measuredValue', this.onIlluminanceMeasuredAttributeReport.bind(this));

        // Tuya specific cluster handlers
		zclNode.endpoints[1].clusters.tuya.on("reporting", value => this.processResponse(value));
		zclNode.endpoints[1].clusters.tuya.on("response", value => this.processResponse(value));

		// Handle IAS Zone enrollment using command interceptor
		const originalSendFrame = zclNode.endpoints[1].sendFrame;
		zclNode.endpoints[1].sendFrame = async (frame, meta) => {
			// Intercept zoneEnrollRequest frames
			if (frame.cluster?.ID === CLUSTER.IAS_ZONE.ID && frame.data?.cmdId === 0) {
				this.log('Intercepted zone enroll request');
				try {
					// Send enrollment response
					await zclNode.endpoints[1].clusters[CLUSTER.IAS_ZONE.NAME].zoneEnrollResponse({
						enrollResponseCode: 'success',
						zoneID: 1
					});
					this.log('Zone enrollment response sent');
					return; // Don't forward the original frame
				} catch (error) {
					this.error('Failed to send enrollment response:', error);
				}
			}
			return originalSendFrame.call(zclNode.endpoints[1], frame, meta);
		};

		// Handle incoming frames manually to catch zone status changes
		const originalHandleFrame = zclNode.endpoints[1].handleFrame;
		zclNode.endpoints[1].handleFrame = (frame, meta) => {
			// Handle IAS Zone frames
			if (frame.cluster?.ID === CLUSTER.IAS_ZONE.ID) {
				if (frame.data?.cmdId === 0) { // zoneStatusChangeNotification
					const data = frame.data.data;
					if (data && data.length >= 2) {
						const zoneStatus = data.readUInt16LE(0);
						const motionDetected = (zoneStatus & 0x01) !== 0; // Check alarm1 bit
						this.log('Manual IAS Zone motion detected:', motionDetected, 'zoneStatus:', zoneStatus);
						this.setCapabilityValue('alarm_motion', motionDetected).catch(this.error);
						return; // Don't forward to default handler
					}
				}
			}
			return originalHandleFrame.call(zclNode.endpoints[1], frame, meta);
		};

	}

	// Handle motion status attribute reports
	onZoneStatusAttributeReport(status) {
		this.log("Motion status: ", status.alarm1);
		this.setCapabilityValue('alarm_motion', status.alarm1).catch(this.error);
	}

	// Handle IAS Zone Status Change Notifications (primary motion detection method)
	onIASZoneStatusChangeNotification({zoneStatus, extendedStatus, zoneId, delay}) {
		this.log('IASZoneStatusChangeNotification received:', zoneStatus, extendedStatus, zoneId, delay);
		this.setCapabilityValue('alarm_motion', zoneStatus.alarm1).catch(this.error);
		// Also handle battery and tamper if available in zoneStatus
		if (zoneStatus.battery !== undefined) {
			this.setCapabilityValue('alarm_battery', zoneStatus.battery).catch(this.error);
		}
		if (zoneStatus.tamper !== undefined) {
			this.setCapabilityValue('alarm_tamper', zoneStatus.tamper).catch(this.error);
		}
	}

    // Handle battery status attribute reports
    onBatteryPercentageRemainingAttributeReport(batteryPercentageRemaining) {
        const batteryThreshold = this.getSetting('batteryThreshold') || 20;
        const batteryLevel = batteryPercentageRemaining / 2; // Convert to percentage
        this.log('measure_battery | Battery level (%):', batteryLevel);
        this.setCapabilityValue('measure_battery', batteryLevel).catch(this.error);
        this.setCapabilityValue('alarm_battery', batteryLevel < batteryThreshold).catch(this.error);
    }
	
    // Handle illuminance attribute reports
    onIlluminanceMeasuredAttributeReport(measuredValue) {
        const luxValue = Math.round(Math.pow(10, ((measuredValue - 1) / 10000))); // Convert measured value to lux
        this.log('measure_luminance | Illuminance (lux):', luxValue);
        this.setCapabilityValue('measure_luminance', luxValue).catch(this.error);
    }

    // Process Tuya-specific data
    processResponse(data) {
        this.log('=== TUYA RESPONSE ===', JSON.stringify(data));
        
        // Handle Tuya datapoints for motion sensor
        if (data && data.dp !== undefined) {
            this.log('Processing Tuya DP:', data.dp, 'datatype:', data.datatype, 'data:', data.data);
            switch (data.dp) {
                case 1: // Motion detection datapoint
                    if (data.datatype === 4) { // Boolean/enum type for Tuya
                        const motionDetected = data.data && data.data[0] === 0; // INVERTED: 0 = motion, 1 = no motion
                        this.log('*** TUYA MOTION DETECTED:', motionDetected, 'raw data:', data.data);
                        this.setCapabilityValue('alarm_motion', motionDetected).catch(this.error);
                    } else {
                        this.log('Motion DP1 unexpected datatype:', data.datatype);
                    }
                    break;
                case 2: // Luminance datapoint (if available via Tuya)
                    if (data.datatype === 2) { // Value type
                        const luxValue = data.data ? (data.data[1] << 8) | data.data[0] : 0;
                        this.log('Tuya luminance (lux):', luxValue);
                        this.setCapabilityValue('measure_luminance', luxValue).catch(this.error);
                    }
                    break;
                case 3: // Battery level datapoint (if available via Tuya)
                    if (data.datatype === 2) { // Value type
                        const batteryLevel = data.data ? data.data[0] : 0;
                        this.log('Tuya battery level (%):', batteryLevel);
                        this.setCapabilityValue('measure_battery', batteryLevel).catch(this.error);
                        const batteryThreshold = this.getSetting('batteryThreshold') || 20;
                        this.setCapabilityValue('alarm_battery', batteryLevel < batteryThreshold).catch(this.error);
                    }
                    break;
                case 4: // Sensitivity or other setting
                    this.log('Tuya DP4 (sensitivity?):', data.data);
                    break;
                case 12: // Unknown datapoint seen in logs
                    this.log('Tuya DP12 (unknown):', data.data);
                    break;
                case 103: // Unknown datapoint seen in logs
                    this.log('Tuya DP103 (unknown):', data.data);
                    break;
                default:
                    this.log('Unknown Tuya datapoint:', data.dp, 'datatype:', data.datatype, 'data:', data.data);
            }
        } else {
            this.log('Tuya response missing DP:', data);
        }
    }
  		
    // Handle device removal
    onDeleted() {
        this.log('Motion Sensor removed');
    }

}

module.exports = motion_sensor_2;


/* "ids": {
	"modelId": "TS0601",
	"manufacturerName": "_TZE200_3towulqd"
  },
  "endpoints": {
	"endpointDescriptors": [
	  {
		"endpointId": 1,
		"applicationProfileId": 260,
		"applicationDeviceId": 1026,
		"applicationDeviceVersion": 0,
		"_reserved1": 1,
		"inputClusters": [
		  0,
		  3,
		  1280,
		  57346,
		  61184,
		  60928,
		  57344,
		  1,
		  1024
		],
		"outputClusters": []
	  }
	],
	"endpoints": {
	  "1": {
		"clusters": {
		  "basic": {
			"attributes": [
			  {
				"acl": [
				  "readable"
				],
				"id": 0,
				"name": "zclVersion"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 1,
				"name": "appVersion"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 2,
				"name": "stackVersion"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 3,
				"name": "hwVersion"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 4,
				"name": "manufacturerName"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 5,
				"name": "modelId"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 7,
				"name": "powerSource"
			  },
			  {
				"acl": [
				  "readable",
				  "writable"
				],
				"id": 18,
				"name": "deviceEnabled"
			  },
			  {
				"acl": [
				"readable"
				],
				"id": 16384,
				"name": "swBuildId"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 65533,
				"name": "clusterRevision"
			  }
			],
			"commandsGenerated": "UNSUP_GENERAL_COMMAND",
			"commandsReceived": "UNSUP_GENERAL_COMMAND"
		  },
		  "identify": {
			"attributes": [
			  {
				"acl": [
				  "readable",
				  "writable"
				],
				"id": 0
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 65533,
				"name": "clusterRevision",
				"value": 1
			  }
			],
			"commandsGenerated": "UNSUP_GENERAL_COMMAND",
			"commandsReceived": "UNSUP_GENERAL_COMMAND"
		  },
		  "iasZone": {
			"attributes": [
			  {
				"acl": [
				  "readable"
				],
				"id": 0,
				"name": "zoneState",
				"value": "notEnrolled"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 1,
				"name": "zoneType",
				"value": "motionSensor"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 2,
				"name": "zoneStatus",
				"value": {
				  "type": "Buffer",
				  "data": [
					0,
					0
				  ]
				}
			  },
			  {
				"acl": [
				  "readable",
				  "writable"
				],
				"id": 16,
				"name": "iasCIEAddress",
				"value": "00:12:4b:00:04:f8:9c:84"
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 17,
				"name": "zoneId",
				"value": 0
			  },
			  {
				"acl": [
				  "readable"
				],
				"id": 65533,
				"name": "clusterRevision",
				"value": 1
			  }
			],
			"commandsGenerated": "UNSUP_GENERAL_COMMAND",
			"commandsReceived": "UNSUP_GENERAL_COMMAND"
		  },
		  "powerConfiguration": {
		  "attributes": [
			{
			  "acl": [
				"readable"
			  ],
			  "id": 0
			},
			{
			  "acl": [
				"readable"
			  ],
			  "id": 32,
			  "name": "batteryVoltage",
			  "value": 33
			},
			{
			  "acl": [
				"readable"
			  ],
			  "id": 33,
			  "name": "batteryPercentageRemaining",
			  "value": 200
			},
			{
			  "acl": [
				"readable"
			  ],
			  "id": 65533,
			  "name": "clusterRevision",
			  "value": 1
			}
		  ],
		  "commandsGenerated": "UNSUP_GENERAL_COMMAND",
		  "commandsReceived": "UNSUP_GENERAL_COMMAND"
		},
		"illuminanceMeasurement": {
		  "attributes": [
			{
			  "acl": [
				"readable"
			  ],
			  "id": 0,
			  "name": "measuredValue",
			  "value": 1000
			},
			{
			  "acl": [
				"readable"
			  ],
			  "id": 1,
			  "name": "minMeasuredValue",
			  "value": 0
			},
			{
			  "acl": [
				"readable"
			  ],
			  "id": 2,
			  "name": "maxMeasuredValue",
			  "value": 4000
			},
			{
			  "acl": [
				"readable"
			  ],
			  "id": 65533,
			  "name": "clusterRevision",
			  "value": 1
			}
		  ],
		  "commandsGenerated": "UNSUP_GENERAL_COMMAND",
		  "commandsReceived": "UNSUP_GENERAL_COMMAND"
		}
	  },
	  "bindings": {}
	}
  }
} */