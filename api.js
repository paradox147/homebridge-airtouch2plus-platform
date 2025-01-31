const net = require("net");
const { Accessory, Service, Characteristic, uuid } = require("homebridge");
const MAGIC = require("./magic"); // Assuming you have MAGIC constants for AC/Group settings

class Airtouch2API {
  constructor(log, config) {
    this.log = log;
    this.config = config;
    this.device = null;
    this.state = {}; // Store the state for the units/groups

    this.connect(config.ip_address); // Assuming 'ip_address' is passed in config
  }

  // Helper function to calculate CRC16
  static crc16(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        const odd = crc & 0x0001;
        crc >>= 1;
        if (odd) crc ^= 0xA001;
      }
    }
    return crc;
  }

  // Helper function to handle undefined/null values
  static isNull(val, nullVal) {
    return val === undefined ? nullVal : val;
  }

  // Connect to Airtouch Touchpad Controller socket
  connect(address) {
    this.device = new net.Socket();
    this.device.connect(9200, address, () => {
      this.log("API | Connected to Airtouch");
      setTimeout(this.GET_AC_STATUS.bind(this), 0);
      setTimeout(this.GET_GROUP_STATUS.bind(this), 2000);
      setInterval(this.GET_GROUP_STATUS.bind(this), 285000);
    });

    this.device.on("close", () => {
      this.log("API | Disconnected from Airtouch");
    });

    this.device.on("readable", () => {
      let header = this.device.read(6);
      if (!header) return;

      const msgid = header[4];
      const msgtype = header[5];
      const datalen = this.device.read(2);
      const data = this.device.read(datalen.readUInt16BE());
      const submsgtype = data[0];
      const crc = this.device.read(2);

      if (crc.readUInt16BE() !== Airtouch2API.crc16([...header.slice(2), ...datalen, ...data])) {
        this.log("API | ERROR: invalid crc");
        return;
      }

      switch (submsgtype) {
        case MAGIC.AT2_SUBMSGTYPE_GROUP_STAT:
          this.decode_groups_status(data);
          break;
        case MAGIC.AT2_SUBMSGTYPE_AC_STAT:
          this.decode_ac_status(data);
          break;
        default:
          this.log("API | WARNING: Unknown submessage type " + submsgtype);
      }
    });

    this.device.on("error", (err) => {
      this.log("API | Connection Error: " + err.message);
      this.device.destroy();
      setTimeout(() => {
        if (!this.device.listening) {
          this.log("API | Attempting reconnect");
          this.connect(address);
        }
      }, 10000);
    });
  }

  // Decode AC status and update Homebridge state
  decode_ac_status(data) {
    const ac_status = [];
    const repeatDataCount = Buffer.from(data.slice(6, 8)).readUInt16BE();
    const repeatData = data.slice(8);
    const repeatDataLen = repeatData.length;

    for (let i = 0; i < repeatDataLen / 10; i++) {
      const unit = repeatData.slice(i * 10, i * 10 + 10);
      ac_status.push({
        ac_unit_number: unit[0] & 0b00001111,
        ac_power_state: (unit[0] & 0b11110000) >> 4,
        ac_mode: (unit[1] & 0b11110000) >> 4,
        ac_fan_speed: unit[1] & 0b00001111,
        ac_target: (unit[2] + 100) / 10,
        ac_temp: ((unit[4] << 8 | unit[5]) - 500) / 10,
      });
    }
    this.emit("ac_status", ac_status);
  }

  // Decode Group status and update Homebridge state
  decode_groups_status(data) {
    const groups_status = [];
    const repeatDataCount = Buffer.from(data.slice(6, 8)).readUInt16BE();
    const repeatData = data.slice(8);
    const repeatDataLen = repeatData.length;

    for (let i = 0; i < repeatDataLen / 8; i++) {
      const group = repeatData.slice(i * 8, i * 8 + 8);
      groups_status.push({
        group_number: group[0] & 0b00111111,
        group_power_state: (group[0] & 0b11000000) >> 6,
        group_damper_position: group[1] & 0b01111111,
        group_has_turbo: (group[6] & 0b10000000) >> 7,
      });
    }
    this.emit("groups_status", groups_status);
  }

  // Helper function to send data to Airtouch controller
  send(data) {
    const id = Math.floor(Math.random() * 255) + 1;
    const msgid = Buffer.alloc(1);
    msgid.writeUInt8(id);
    const datalen = Buffer.alloc(2);
    datalen.writeUInt16BE(data.length);
    const payload = Buffer.from([...MAGIC.AT2_ADDRESS_BYTES, ...msgid, MAGIC.AT2_MSGTYPE_CCSTAT, ...datalen, ...data]);
    const crc = Buffer.alloc(2);
    crc.writeUInt16BE(Airtouch2API.crc16(payload));
    const message = Buffer.from([...MAGIC.AT2_HEADER_BYTES, ...payload, ...crc]);

    this.device.write(message);
  }

  // Request AC status
  GET_AC_STATUS() {
    const msg = Buffer.from([MAGIC.AT2_SUBMSGTYPE_AC_STAT, 0, 0, 0, 0, 0, 0, 0]);
    this.send(msg);
  }

  // Request Group status
  GET_GROUP_STATUS() {
    const msg = Buffer.from([MAGIC.AT2_SUBMSGTYPE_GROUP_STAT, 0, 0, 0, 0, 0, 0, 0]);
    this.send(msg);
  }

  // Other helper functions to handle AC controls (set temperature, fan speed, etc.) would go here.
}

module.exports = (homebridge) => {
  homebridge.registerAccessory("homebridge-airtouch", "Airtouch2", Airtouch2API);
};
