// main/osc.js
// Minimal OSC 1.0 encode / decode (strings, int32, float32, booleans, bundles)

/**
 * Null-terminate and pad a string to a multiple of 4 bytes
 * @param {String} str
 * @returns {Buffer}
 */
const encodeString = (str) => {
	const raw = Buffer.from(String(str), 'utf8');
	const padded = Buffer.alloc(Math.ceil((raw.length + 1) / 4) * 4);
	raw.copy(padded);
	return padded;
}

/**
 * Encode an OSC message
 * Numbers that are whole are sent as int32, others as float32. Wrap a value as
 * {type: 'f', value} to force a type.
 * @param {String} address e.g. "/go"
 * @param {Array<String | Number | boolean | {type: String, value: any}>} args
 * @returns {Buffer}
 */
const encodeMessage = (address, args = []) => {
	let tags = ",";
	const data = [];

	for (const arg of args) {
		const {type, value} = (arg !== null && typeof arg === 'object')
			? arg
			: {type: typeof arg === 'number' ? (Number.isInteger(arg) ? 'i' : 'f') : typeof arg === 'boolean' ? (arg ? 'T' : 'F') : 's', value: arg};

		tags += type;

		if (type === 's') {
			data.push(encodeString(value));
		} else if (type === 'i') {
			const b = Buffer.alloc(4);
			b.writeInt32BE(value);
			data.push(b);
		} else if (type === 'f') {
			const b = Buffer.alloc(4);
			b.writeFloatBE(value);
			data.push(b);
		}
		// T / F carry no data
	}

	return Buffer.concat([encodeString(address), encodeString(tags), ...data]);
}

/**
 * Read a padded string from a buffer
 * @param {Buffer} buf
 * @param {Number} offset
 * @returns {[String, Number]} value and next offset
 */
const readString = (buf, offset) => {
	const end = buf.indexOf(0, offset);
	if (end === -1) throw new Error("Unterminated OSC string");
	return [buf.toString('utf8', offset, end), Math.ceil((end + 1) / 4) * 4];
}

/**
 * Decode an OSC packet (message or bundle)
 * @param {Buffer} buf
 * @returns {{address: String, args: Array}[]} messages (bundles are flattened)
 */
const decodePacket = (buf) => {
	if (buf.subarray(0, 8).toString() === "#bundle\0") {
		const messages = [];
		let offset = 16; // "#bundle\0" + 8 byte timetag

		while (offset + 4 <= buf.length) {
			const size = buf.readInt32BE(offset);
			messages.push(...decodePacket(buf.subarray(offset + 4, offset + 4 + size)));
			offset += 4 + size;
		}
		return messages;
	}

	let [address, offset] = readString(buf, 0);
	const args = [];

	// Messages without a type tag string have no arguments
	if (offset < buf.length && buf[offset] === 0x2c /* , */) {
		let tags;
		[tags, offset] = readString(buf, offset);

		for (const tag of tags.slice(1)) {
			switch (tag) {
				case 's':
				case 'S': {
					let value;
					[value, offset] = readString(buf, offset);
					args.push(value);
					break;
				}
				case 'i':
					args.push(buf.readInt32BE(offset));
					offset += 4;
					break;
				case 'f':
					args.push(buf.readFloatBE(offset));
					offset += 4;
					break;
				case 'd':
					args.push(buf.readDoubleBE(offset));
					offset += 8;
					break;
				case 'h':
					args.push(Number(buf.readBigInt64BE(offset)));
					offset += 8;
					break;
				case 'b': {
					const size = buf.readInt32BE(offset);
					args.push(buf.subarray(offset + 4, offset + 4 + size));
					offset += 4 + Math.ceil(size / 4) * 4;
					break;
				}
				case 'T': args.push(true); break;
				case 'F': args.push(false); break;
				case 'N': args.push(null); break;
				default:
					throw new Error(`Unsupported OSC type tag '${tag}'`);
			}
		}
	}

	return [{address, args}];
}

export { encodeMessage, decodePacket };
