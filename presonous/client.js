class Client {
    setMute(selector, status) {
		const targetString = this._getMuteTargetString(selector);
		const shouldInvert = !!selector.mixType;
		let state = status === "toggle" ? !this.state.get(targetString) : status;
		if (status !== "toggle" && shouldInvert) state = !state;
		this._sendPacket(MessageCode.ParamValue, Buffer.concat([Buffer.from(targetString + "\0\0\0"), toBoolean(state)]));
	}

    _getMuteTargetString(selector) {
		let targetString = parseChannelString(selector);
		if (selector.mixType) targetString += `/assign_${selector.mixType.toLowerCase()}${selector.mixNumber}`;
		else targetString += "/mute";
		return targetString;
	}
}