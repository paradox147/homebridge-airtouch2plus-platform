const MAGIC = require("./magic");
var net = require("net");

// Airtouch API
// TCP socket client for the Airtouch2+ Touchpad Controller
// Listens and decodes broadcast messages containing AC and Group states
// Encodes and sends messages containing AC and Group commands
//
// The protocol for the AirTouch2+ is based on the Communication Protocol V1.0.1 pdf from polyaire
//Note: // seems the repeat data count (bytes 5 and 6) and the repeat data length (bytes 7 and 8) are swapped compared to Communication Protocol PDF
function Airtouch2API(log) {
    this.log = log;
};

// messages have the data checksummed using modbus crc16
// crc16 implementation from https://github.com/yuanxu2017/modbus-crc16
function crc16(buffer) {
    var crc = 0xFFFF;
    var odd;

    for (var i = 0; i < buffer.length; i++) {
        crc = crc ^ buffer[i];

        for (var j = 0; j < 8; j++) {
            odd = crc & 0x0001;
            crc = crc >> 1;
            if (odd) {
                crc = crc ^ 0xA001;
            }
        }
    }
    return crc;
};

// check if value is undefined, and replace it with a default value
function isNull(val, nullVal) {
    return val === undefined ? nullVal : val;
};

// send message to the Airtouch2+ Touchpad Controller
Airtouch2API.prototype.send = function(data) {
    let id = Math.floor(Math.random() * Math.floor(255)) + 1;
    type = data[0];
    this.log("API | Sending message " + id + " with submsg type 0x" + type.toString(16) + " containing:");
    this.log(data);
    // generate a random message id
    let msgid = Buffer.alloc(1);
    msgid.writeUInt8(id);
    // get data length
    let datalen = Buffer.alloc(2);
    datalen.writeUInt16BE(data.length);
    // assemble payload
    let payload = Buffer.from([...MAGIC.AT2_ADDRESS_BYTES, ...msgid, MAGIC.AT2_MSGTYPE_CCSTAT, ...datalen, ...data]);
    // calculate payload crc
    let crc = Buffer.alloc(2);
    crc.writeUInt16BE(crc16(payload));
    // assemble message
    let message = Buffer.from([...MAGIC.AT2_HEADER_BYTES, ...payload,  ...crc]);
    this.log("API | Message to send:");
    this.log(message);
    // send message
    this.device.write(message);
};

// encode a message for AC control
// seems the repeat data count (bytes 5 and 6) and the repeat data length (bytes 7 and 8) are swapped compared to Communication Protocol PDF
Airtouch2API.prototype.encode_ac_control = function(unit) {
    //sub message type
    let byte1 = MAGIC.AT2_SUBMSGTYPE_AC_CTRL; 
    //keep 0
    let byte2 = 0; 
    //normal data length (bytes 3 and 4) - there is no normal data for AC control so 0x0000
    let byte3 = 0;
    let byte4 = 0;
    //repeat data length (bytes 5 and 6) - 4 bytes of data to follow so 0x0004
    let byte5 = 0; 
    let byte6 = 4; 
    //repeat data count (bytes 7 and 8) - since we are only controlling 1 unit the repeat count is 0x0001
    let byte7 = 0;
    let byte8 = 1;
    //repeat data (only one repeat)
    //bits 1-4 are AC number, bits 5-8 are the power setting
    let byte9 = isNull(unit.ac_unit_number, MAGIC.AT2_AC_UNIT_DEFAULT);
    byte9 = byte9 | ((isNull(unit.ac_power_state, MAGIC.AT2_AC_POWER_STATES.KEEP)) << 4);
    //bits 1-4 are fan speed, bits 5-8 are AC mode
    let byte10 = isNull(unit.ac_fan_speed, MAGIC.AT2_AC_FAN_SPEEDS.KEEP);
    byte10 = byte10 | ((isNull(unit.ac_mode, MAGIC.AT2_AC_MODES.KEEP)) << 4);
    //setpoint control
    let byte11 = isNull(unit.ac_setpoint_control, MAGIC.AT2_AC_SETPOINT_CONTROL.KEEP);
    let byte12 = (isNull(unit.ac_target_value, MAGIC.AT2_AC_SETPOINT_DEFAULT)*10)-100;

    return Buffer.from([byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8, byte9, byte10, byte11, byte12]);
};

// send command to change AC mode (OFF/HEATING/COOLING/AUTO)
Airtouch2API.prototype.acSetCurrentHeatingCoolingState = function(unit_number, state) {
    switch (state) {
        case 0: // OFF
            target = {
                ac_unit_number: unit_number,
                ac_power_state: MAGIC.AT2_AC_POWER_STATES.OFF,
            };
            break;
        case 1: // HEAT
            target = {
                ac_unit_number: unit_number,
                ac_power_state: MAGIC.AT2_AC_POWER_STATES.ON,
                ac_mode: MAGIC.AT2_AC_MODES.HEAT,
            };
            break;
        case 2: // COOL
            target = {
                ac_unit_number: unit_number,
                ac_power_state: MAGIC.AT2_AC_POWER_STATES.ON,
                ac_mode: MAGIC.AT2_AC_MODES.COOL,
            };
            break;
        default: // everything else is AUTO
            target = {
                ac_unit_number: unit_number,
                ac_power_state: MAGIC.AT2_AC_POWER_STATES.ON,
                ac_mode: MAGIC.AT2_AC_MODES.AUTO,
            };
    }
    this.log("API | Setting AC heating/cooling state to: " + JSON.stringify(target));
    let data = this.encode_ac_control(target);
    this.send(data);
};

// send command to change AC target temperature
Airtouch2API.prototype.acSetTargetTemperature = function(unit_number, temp) {
    target = {
        ac_unit_number: unit_number,
        ac_target_value: temp,
        ac_setpoint_control: MAGIC.AT2_AC_SETPOINT_CONTROL.SET_VALUE
    };
    this.log("API | Setting AC target temperature " + JSON.stringify(target));
    let data = this.encode_ac_control(target);
    this.send(data);
};

// send command to change AC fan speed 
Airtouch2API.prototype.acSetFanSpeed = function(unit_number, speed) {
    target = {
        ac_unit_number: unit_number,
        ac_fan_speed: speed,
    };
    this.log("API | Setting AC fan speed " + JSON.stringify(target));
    let data = this.encode_ac_control(target);
    this.send(data);
};

// send command to get AC status
Airtouch2API.prototype.GET_AC_STATUS = function() {
    //sub message type
    let byte1 = MAGIC.AT2_SUBMSGTYPE_AC_STAT; 
    //keep 0
    let byte2 = 0; 
    //normal data length (bytes 3 and 4) - there is no normal data for AC status so 0x0000
    let byte3 = 0;
    let byte4 = 0;
    //repeat data count (bytes 5 and 6) - repeat count is 0 for status request
    let byte5 = 0;
    let byte6 = 0;
    //repeat data length (bytes 7 and 8) - repeat length is 0 for status request
    let byte7 = 0; 
    let byte8 = 0; 
    this.send(Buffer.from([byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8]));
};

// decode AC status information and send it to homebridge
Airtouch2API.prototype.decode_ac_status = function(data) {
    ac_status = [];
    RepeatDataCount = Buffer.from([...data.slice(6,8)]).readUInt16BE(); // seems the repeat data count (bytes 5 and 6) and the repeat data length (bytes 7 and 8) are swapped in returned data
    RepeatData = data.slice(8);
    RepeatDataLen = RepeatData.length;
    if ((RepeatDataCount*10) != RepeatDataLen) {
        this.log("API | WARNING: AC Status message repeat data length mismatch " + RepeatDataCount.toString(10) + " *10 != " + RepeatDataLen.toString(10));
    }
    for (i = 0; i < RepeatDataLen/10; i++) {
        let unit = RepeatData.slice(i*10, i*10+10);
        ac_power_state = (unit[0] & 0b11110000) >> 4;
        ac_unit_number = unit[0] & 0b00001111;
        ac_mode = (unit[1] & 0b11110000) >> 4;
        ac_fan_speed = unit[1] & 0b00001111;
        ac_target = (unit[2] + 100)/10;
        ac_spill = (unit[3] & 0b00000010) >> 2;
        ac_timer = (unit[3] & 0b00000001);
        //ac_bypass = (unit[3] & 0b00000100) >> 3;
        //ac_turbo = (unit[3] & 0b00001000) >> 4;
        ac_temp = ((Buffer.from([unit[4], unit[5]]).readUInt16BE()) - 500)/10;
        ac_error_code = Buffer.from([unit[6], unit[7]]).readUInt16BE();
        ac_status.push({
            ac_unit_number: ac_unit_number,
            ac_power_state: ac_power_state,
            ac_mode: ac_mode,
            ac_fan_speed: ac_fan_speed,
            ac_target: ac_target,
            ac_temp: ac_temp,
            ac_spill: ac_spill,
            ac_timer_set: ac_timer,
            ac_error_code: ac_error_code,
        });
    }
    this.emit("ac_status", ac_status);
};

// encode a message for Group control
// seems the repeat data count (bytes 5 and 6) and the repeat data length (bytes 7 and 8) are swapped compared to Communication Protocol PDF
Airtouch2API.prototype.encode_group_control = function(group) {
    //sub message type
    let byte1 = MAGIC.AT2_SUBMSGTYPE_GROUP_CTRL; 
    //keep 0
    let byte2 = 0; 
    //normal data length (bytes 3 and 4) - there is no normal data for Group control so 0x0000
    let byte3 = 0;
    let byte4 = 0;
    //repeat data length (bytes 5 and 6) - 4 bytes of data to follow so 0x0004
    let byte5 = 0; 
    let byte6 = 4; 
    //repeat data count (bytes 7 and 8) - since we are only controlling 1 unit the repeat count is 0x0001
    let byte7 = 0;
    let byte8 = 1;
    //repeat data (only one repeat)
    //bits 1-6 are the Group number, bits 7-8 are Kept 0
    let byte9 = (isNull(group.group_number, MAGIC.AT2_GROUP_NUMBER_DEFAULT) & 0b00111111);
    //bits 1-3 Power, bits 4-5 are Kept 0, bits 6-8 are group Setting value
    let byte10 = isNull(group.group_power_state, MAGIC.AT2_GROUP_POWER_STATES_CTRL.KEEP);
    byte10 = ((byte10 | ((isNull(group.group_target_type, MAGIC.AT2_GROUP_SETTING_VALUES.KEEP)) << 5)) & 0b11100111);
    //setpoint control
    let byte11 = group.group_target || 0;
    //Keep 0
    let byte12 = 0;

    return Buffer.from([byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8, byte9, byte10, byte11, byte12]);
};

// send command to change zone power state (ON/OFF)
Airtouch2API.prototype.zoneSetActive = function(group_number, active) {
    target = {
        group_number: group_number,
        group_power_state: active ? MAGIC.AT2_GROUP_POWER_STATES_CTRL.ON : MAGIC.AT2_GROUP_POWER_STATES_CTRL.OFF,
    };
    this.log("API | Setting zone state: " + JSON.stringify(target));
    let data = this.encode_group_control(target);
    this.send(data);
};

// send command to set damper position
Airtouch2API.prototype.zoneSetDamperPosition = function(group_number, position) {
    target = {
        group_number: group_number,
        group_target_type: MAGIC.AT2_GROUP_SETTING_VALUES.SET_VALUE,
        group_target: position,
    };
    this.log("API | Setting damper position: " + JSON.stringify(target));
    let data = this.encode_group_control(target);
    this.send(data);
};

// // send command to set control type 
// Airtouch2API.prototype.zoneSetControlType = function(group_number, type) {
//  target = {
//      group_number: group_number,
//      group_control_type: MAGIC.AT2_GROUP_CONTROL_TYPES.DAMPER + type,
//  };
//  this.log("API | Setting control type: " + JSON.stringify(target));
//  let data = this.encode_group_control(target);
//  this.send(MAGIC.AT2_MSGTYPE_GRP_CTRL, data);
// };

// // send command to set target temperature
// Airtouch2API.prototype.zoneSetTargetTemperature = function(group_number, temp) {
//  target = {
//      group_number: group_number,
//      group_target_type: MAGIC.AT2_GROUP_SETTING_VALUES.TEMPERATURE,
//      group_target: temp,
//  };
//  this.log("API | Setting target temperature: " + JSON.stringify(target));
//  let data = this.encode_group_control(target);
//  this.send(MAGIC.AT2_MSGTYPE_GRP_CTRL, data);
// };

// send command to get group status
Airtouch2API.prototype.GET_GROUP_STATUS = function() {
    //sub message type
    let byte1 = MAGIC.AT2_SUBMSGTYPE_GROUP_STAT; 
    //keep 0
    let byte2 = 0; 
    //normal data length (bytes 3 and 4) - there is no normal data for Group status so 0x0000
    let byte3 = 0;
    let byte4 = 0;
    //repeat data count (bytes 5 and 6) - repeat count is 0 for status request
    let byte5 = 0;
    let byte6 = 0;
    //repeat data length (bytes 7 and 8) - repeat length is 0 for status request
    let byte7 = 0; 
    let byte8 = 0; 
    this.send(Buffer.from([byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8]));
};

// decode groups status information and send it to homebridge
Airtouch2API.prototype.decode_groups_status = function(data) {
    groups_status = [];
    RepeatDataCount = Buffer.from([...data.slice(6,8)]).readUInt16BE(); // seems the repeat data count (bytes 5 and 6) and the repeat data length (bytes 7 and 8) are swapped in returned data
    RepeatData = data.slice(8);
    RepeatDataLen =RepeatData.length;
    if ((RepeatDataCount*8) != RepeatDataLen) {
        this.log("API | WARNING: Group Status message repeat data length mismatch " + RepeatDataCount.toString(10) + " *8 != " + RepeatDataLen.toString(10));
    }
    for (i = 0; i < RepeatDataLen/8; i++) {
        let group = RepeatData.slice(i*8, i*8+8);
        group_power_state = (group[0] & 0b11000000) >> 6;
        group_number = group[0] & 0b00111111;
        //group_control_type = (group[1] & 0b10000000) >> 7;
        group_open_perc = group[1] & 0b01111111;
        //group_battery_low = (group[2] & 0b10000000) >> 7;
        group_has_turbo = (group[6] & 0b10000000) >> 7;
        //group_target = (group[2] & 0b00111111) * 1.0;
        //group_has_sensor = (group[3] & 0b10000000) >> 7;
        //group_temp = (((group[4] << 3) + ((group[5] & 0b11100000) >> 5)) - 500) / 10;
        group_has_spill = (group[6] & 0b00000010) >> 1;
        groups_status.push({
            group_number: group_number,
            group_power_state: group_power_state,
            //group_control_type: group_control_type,
            group_damper_position: group_open_perc,
            //group_target: group_target,
            //group_temp: group_temp,
            //group_battery_low: group_battery_low,
            group_has_turbo: group_has_turbo,
            //group_has_sensor: group_has_sensor,
            group_has_spill: group_has_spill,
        });
    }
    this.emit("groups_status", groups_status);
};

// connect to Airtouch Touchpad Controller socket on tcp port 9200
Airtouch2API.prototype.connect = function(address) {
    this.device = new net.Socket();
    this.device.connect(9200, address, () => {
        this.log("API | Connected to Airtouch");
        // request information from Airtouch after connection
        setTimeout(this.GET_AC_STATUS.bind(this), 0);
        setTimeout(this.GET_GROUP_STATUS.bind(this), 2000);
        // schedule group status every 4.75 minutes to get updates for FakeGato history service
        setInterval(this.GET_GROUP_STATUS.bind(this), 285000);
    });
    this.device.on("close", () => {
        this.log("API | Disconnected from Airtouch");
    });
    // listener callback
    this.device.on("readable", () => {
        let header = this.device.read(6);
        if (!header)
            return;
        if (header[0] != MAGIC.AT2_HEADER_BYTES[0]
            || header[1] != MAGIC.AT2_HEADER_BYTES[1]
            || header[3] != MAGIC.AT2_ADDRESS_BYTES[0]) {
            this.log("API | WARNING: invalid header " + header.toString("hex"));
        }
        let msgid = header[4];
        let msgtype = header[5];
        let datalen = this.device.read(2);
        let data = this.device.read(datalen.readUInt16BE());
        let submsgtype = data[0];
        let crc = this.device.read(2);
        this.log("API | Received message with id " + msgid + " and data " + data.toString("hex"));
        if (crc.readUInt16BE() != crc16([...header.slice(2), ...datalen, ...data])) {
            this.log("API | ERROR: invalid crc");
            return;
        }
        switch (submsgtype) {
            case MAGIC.AT2_SUBMSGTYPE_GROUP_STAT:
                // decode groups status info
                this.decode_groups_status(data);
                break;
            case MAGIC.AT2_SUBMSGTYPE_AC_STAT:
                // decode ac status info
                this.decode_ac_status(data);
                break;
        }
    });

    // error handling to stop connection errors bringing down homebridge
    this.device.on("error", function(err) {
        this.log("API | Connection Error: " + err.message);
        this.device.destroy(); //close the connection even though its already broken
        setTimeout(() => {
            if (!this.device.listening) { //only attempt reconnect if not already re-connected
                this.log("API | Attempting reconnect");
                this.emit("attempt_reconnect");
            }
        }, 10000);
    }.bind(this));

};

module.exports = Airtouch2API;


