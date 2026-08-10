class DCA {

	/**
	 * 
	 * @param {int} number 
	 * @param {int[]} channels 
	 * @param {String} name 
	 * @param {float} level 
	 * @param {String} color color hex
	 */
	constructor(number, channels, name, level, color) {
		this.number = number;
		this.channels = channels;
		this.name = name;
		this.level = level;
		this.color = color;
	}

	/**
	 * Is Valid
	 * @returns {boolean} is valid
	 */
	is_valid() {
		return this.number !== -1;
	}

	/**
	 * Send DCA config to the board
	 */
	send() {
		window.presonus.set_dta(this);
	} 

	/**
	 * Get Channel Selector
	 * @returns {ChannelSelector} selector
	 */
	get_selector() {
		return {
			type: 'DCA',
			channel: this.number
		};
	}
}

export default DCA;