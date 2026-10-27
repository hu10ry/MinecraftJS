class PacketBuffer {
  constructor(data) {
    if (data instanceof ArrayBuffer) {
      this.buffer = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      this.buffer = data;
    } else if (typeof data === "string") {
      const binary = atob(data);
      this.buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++)
        this.buffer[i] = binary.charCodeAt(i);
    } else {
      this.buffer = new Uint8Array(0);
    }
    this.offset = 0;
  }

  remaining() {
    return this.buffer.length - this.offset;
  }

  readByte() {
    if (this.offset >= this.buffer.length) throw new Error("Buffer underflow");
    return this.buffer[this.offset++];
  }

  readUByte() {
    return this.readByte() & 0xff;
  }

  readBoolean() {
    return this.readByte() !== 0;
  }

  readShort() {
    const val = (this.buffer[this.offset] << 8) | this.buffer[this.offset + 1];
    this.offset += 2;
    return val > 32767 ? val - 65536 : val;
  }

  readUShort() {
    const val = (this.buffer[this.offset] << 8) | this.buffer[this.offset + 1];
    this.offset += 2;
    return val;
  }

  readInt() {
    const val =
      (this.buffer[this.offset] << 24) |
      (this.buffer[this.offset + 1] << 16) |
      (this.buffer[this.offset + 2] << 8) |
      this.buffer[this.offset + 3];
    this.offset += 4;
    return val;
  }

  readLong() {
    const high = this.readInt();
    const low = this.readInt();
    return [high, low];
  }

  readFloat() {
    const view = new DataView(
      this.buffer.buffer,
      this.buffer.byteOffset + this.offset,
      4,
    );
    this.offset += 4;
    return view.getFloat32(0, false);
  }

  readDouble() {
    const view = new DataView(
      this.buffer.buffer,
      this.buffer.byteOffset + this.offset,
      8,
    );
    this.offset += 8;
    return view.getFloat64(0, false);
  }

  readVarInt() {
    let value = 0;
    let length = 0;
    let currentByte;
    do {
      currentByte = this.readByte() & 0xff;
      value |= (currentByte & 0x7f) << (length * 7);
      length++;
      if (length > 5) throw new Error("VarInt too big");
    } while ((currentByte & 0x80) !== 0);
    if (value > 0x7fffffff) value -= 0x100000000;
    return value;
  }

  readString() {
    const length = this.readVarInt();
    const bytes = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  readUUID() {
    const bytes = this.buffer.slice(this.offset, this.offset + 16);
    this.offset += 16;
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  readBytes(length) {
    const bytes = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readRestBytes() {
    return this.readBytes(this.remaining());
  }

  readSlot() {
    const id = this.readShort();
    if (id === -1) return null;
    const count = this.readByte();
    const damage = this.readShort();
    let nbt = null;
    const nbtTag = this.readByte();
    if (nbtTag !== 0) {
      // Named root tag: skip name then payload
      const nameLen = this.readUShort();
      this.offset += nameLen;
      this._skipNBTPayload(nbtTag);
    }
    return { id, count, damage, nbt };
  }

  skipNBT(tagType) {
    if (tagType === undefined) tagType = this.readByte();
    if (tagType === 0) return;
    // Root named tag: skip name
    const nameLen = this.readUShort();
    this.offset += nameLen;
    this._skipNBTPayload(tagType);
  }

  _skipNBTPayload(tagType) {
    switch (tagType) {
      case 0:
        return;
      case 1:
        this.offset += 1;
        return;
      case 2:
        this.offset += 2;
        return;
      case 3:
        this.offset += 4;
        return;
      case 4:
        this.offset += 8;
        return;
      case 5:
        this.offset += 4;
        return;
      case 6:
        this.offset += 8;
        return;
      case 7: {
        const len = this.readInt();
        this.offset += len;
        return;
      }
      case 8: {
        const len = this.readUShort();
        this.offset += len;
        return;
      }
      case 9: {
        const listType = this.readByte();
        const listLen = this.readInt();
        for (let i = 0; i < listLen; i++) this._skipNBTPayload(listType);
        return;
      }
      case 10: {
        while (true) {
          const t = this.readByte();
          if (t === 0) return;
          const nameLen = this.readUShort();
          this.offset += nameLen;
          this._skipNBTPayload(t);
        }
      }
      case 11: {
        const len = this.readInt();
        this.offset += len * 4;
        return;
      }
      default:
        return;
    }
  }

  readPosition() {
    const val = this.readLong();
    const high = val[0];
    const low = val[1] >>> 0;
    // x = bits 63..38, y = bits 37..26, z = bits 25..0
    let x = high >> 6;
    let y = ((high & 0x3f) << 6) | ((low >>> 26) & 0x3f);
    let z = low & 0x3ffffff;
    if (x >= 0x2000000) x -= 0x4000000;
    if (y >= 0x800) y -= 0x1000;
    if (z >= 0x2000000) z -= 0x4000000;
    return { x, y, z };
  }

  readAngle() {
    return (this.readByte() / 256) * 360;
  }

  readMetadata() {
    const meta = {};
    while (true) {
      const item = this.readUByte();
      if (item === 0xff || item === 127) break;
      const index = item & 0x1f;
      const type = (item >> 5) & 0x07;
      switch (type) {
        case 0:
          meta[index] = this.readByte();
          break;
        case 1:
          meta[index] = this.readShort();
          break;
        case 2:
          meta[index] = this.readInt();
          break;
        case 3:
          meta[index] = this.readFloat();
          break;
        case 4:
          meta[index] = this.readString();
          break;
        case 5:
          meta[index] = this.readSlot();
          break;
        case 6:
          meta[index] = {
            x: this.readInt(),
            y: this.readInt(),
            z: this.readInt(),
          };
          break;
        case 7:
          meta[index] = {
            yaw: this.readFloat(),
            pitch: this.readFloat(),
            roll: this.readFloat(),
          };
          break;
        default:
          return meta;
      }
    }
    return meta;
  }
}

class PacketWriter {
  constructor() {
    this.parts = [];
  }

  writeByte(val) {
    this.parts.push(new Uint8Array([val & 0xff]));
    return this;
  }

  writeBoolean(val) {
    return this.writeByte(val ? 1 : 0);
  }

  writeShort(val) {
    this.parts.push(new Uint8Array([(val >> 8) & 0xff, val & 0xff]));
    return this;
  }

  writeUShort(val) {
    return this.writeShort(val);
  }

  writeInt(val) {
    this.parts.push(
      new Uint8Array([
        (val >> 24) & 0xff,
        (val >> 16) & 0xff,
        (val >> 8) & 0xff,
        val & 0xff,
      ]),
    );
    return this;
  }

  writeLong(high, low) {
    this.writeInt(high);
    this.writeInt(low);
    return this;
  }

  writeFloat(val) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, false);
    this.parts.push(new Uint8Array(buf));
    return this;
  }

  writeDouble(val) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, val, false);
    this.parts.push(new Uint8Array(buf));
    return this;
  }

  writeVarInt(val) {
    if (val < 0) val += 0x100000000;
    const bytes = [];
    while (true) {
      if ((val & ~0x7f) === 0) {
        bytes.push(val);
        break;
      }
      bytes.push((val & 0x7f) | 0x80);
      val >>>= 7;
    }
    this.parts.push(new Uint8Array(bytes));
    return this;
  }

  writeString(str) {
    const encoded = new TextEncoder().encode(str);
    this.writeVarInt(encoded.length);
    this.parts.push(encoded);
    return this;
  }

  writePosition(x, y, z) {
    // Position encoded as 64-bit: x(26 bits) | y(12 bits) | z(26 bits)
    const xBits = (x & 0x3ffffff) >>> 0;
    const yBits = (y & 0xfff) >>> 0;
    const zBits = (z & 0x3ffffff) >>> 0;
    const high = (xBits << 6) | (yBits >>> 6);
    const low = ((yBits & 0x3f) << 26) | zBits;
    return this.writeLong(high, low >>> 0);
  }

  writeBytes(bytes) {
    this.parts.push(
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    );
    return this;
  }

  toBase64() {
    const merged = this.build();
    let binary = "";
    for (let i = 0; i < merged.length; i++)
      binary += String.fromCharCode(merged[i]);
    return btoa(binary);
  }

  build() {
    let totalLength = 0;
    for (const p of this.parts) totalLength += p.length;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const p of this.parts) {
      result.set(p, offset);
      offset += p.length;
    }
    return result;
  }
}

// MC 1.8.9 protocol packet IDs (play state, clientbound)
const ServerPackets = {
  KEEP_ALIVE: 0x00,
  JOIN_GAME: 0x01,
  CHAT_MESSAGE: 0x02,
  TIME_UPDATE: 0x03,
  ENTITY_EQUIPMENT: 0x04,
  SPAWN_POSITION: 0x05,
  UPDATE_HEALTH: 0x06,
  RESPAWN: 0x07,
  PLAYER_POSITION_AND_LOOK: 0x08,
  HELD_ITEM_CHANGE: 0x09,
  USE_BED: 0x0a,
  ANIMATION: 0x0b,
  SPAWN_PLAYER: 0x0c,
  COLLECT_ITEM: 0x0d,
  SPAWN_OBJECT: 0x0e,
  SPAWN_MOB: 0x0f,
  SPAWN_PAINTING: 0x10,
  SPAWN_EXPERIENCE_ORB: 0x11,
  ENTITY_VELOCITY: 0x12,
  DESTROY_ENTITIES: 0x13,
  ENTITY: 0x14,
  ENTITY_RELATIVE_MOVE: 0x15,
  ENTITY_LOOK: 0x16,
  ENTITY_LOOK_AND_RELATIVE_MOVE: 0x17,
  ENTITY_TELEPORT: 0x18,
  ENTITY_HEAD_LOOK: 0x19,
  ENTITY_STATUS: 0x1a,
  ATTACH_ENTITY: 0x1b,
  ENTITY_METADATA: 0x1c,
  ENTITY_EFFECT: 0x1d,
  REMOVE_ENTITY_EFFECT: 0x1e,
  SET_EXPERIENCE: 0x1f,
  ENTITY_PROPERTIES: 0x20,
  CHUNK_DATA: 0x21,
  MULTI_BLOCK_CHANGE: 0x22,
  BLOCK_CHANGE: 0x23,
  BLOCK_ACTION: 0x24,
  BLOCK_BREAK_ANIMATION: 0x25,
  MAP_CHUNK_BULK: 0x26,
  EXPLOSION: 0x27,
  EFFECT: 0x28,
  SOUND_EFFECT: 0x29,
  PARTICLE: 0x2a,
  CHANGE_GAME_STATE: 0x2b,
  SPAWN_GLOBAL_ENTITY: 0x2c,
  OPEN_WINDOW: 0x2d,
  CLOSE_WINDOW: 0x2e,
  SET_SLOT: 0x2f,
  WINDOW_ITEMS: 0x30,
  WINDOW_PROPERTY: 0x31,
  CONFIRM_TRANSACTION: 0x32,
  UPDATE_SIGN: 0x33,
  MAP: 0x34,
  UPDATE_BLOCK_ENTITY: 0x35,
  OPEN_SIGN_EDITOR: 0x36,
  STATISTICS: 0x37,
  PLAYER_LIST_ITEM: 0x38,
  PLAYER_ABILITIES: 0x39,
  TAB_COMPLETE: 0x3a,
  SCOREBOARD_OBJECTIVE: 0x3b,
  UPDATE_SCORE: 0x3c,
  DISPLAY_SCOREBOARD: 0x3d,
  TEAMS: 0x3e,
  PLUGIN_MESSAGE: 0x3f,
  DISCONNECT: 0x40,
  SERVER_DIFFICULTY: 0x41,
  COMBAT_EVENT: 0x42,
  CAMERA: 0x43,
  WORLD_BORDER: 0x44,
  TITLE: 0x45,
  SET_COMPRESSION: 0x46,
  PLAYER_LIST_HEADER_FOOTER: 0x47,
  RESOURCE_PACK_SEND: 0x48,
  UPDATE_ENTITY_NBT: 0x49,
};

// Serverbound packet IDs (play state)
const ClientPackets = {
  KEEP_ALIVE: 0x00,
  CHAT_MESSAGE: 0x01,
  USE_ENTITY: 0x02,
  PLAYER: 0x03,
  PLAYER_POSITION: 0x04,
  PLAYER_LOOK: 0x05,
  PLAYER_POSITION_AND_LOOK: 0x06,
  PLAYER_DIGGING: 0x07,
  PLAYER_BLOCK_PLACEMENT: 0x08,
  HELD_ITEM_CHANGE: 0x09,
  ANIMATION: 0x0a,
  ENTITY_ACTION: 0x0b,
  STEER_VEHICLE: 0x0c,
  CLOSE_WINDOW: 0x0d,
  CLICK_WINDOW: 0x0e,
  CONFIRM_TRANSACTION: 0x0f,
  CREATIVE_INVENTORY_ACTION: 0x10,
  ENCHANT_ITEM: 0x11,
  UPDATE_SIGN: 0x12,
  PLAYER_ABILITIES: 0x13,
  TAB_COMPLETE: 0x14,
  CLIENT_SETTINGS: 0x15,
  CLIENT_STATUS: 0x16,
  PLUGIN_MESSAGE: 0x17,
  SPECTATE: 0x18,
  RESOURCE_PACK_STATUS: 0x19,
};
