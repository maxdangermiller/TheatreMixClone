import DCA from "./dca";

export default class Cue {
	constructor(index = 0, point = 0) {
		this.index = index
		this.point = point;
		this.dcas = [];

		for (let i = 0; i < 8; i++) {
			this.dcas[i] = new DCA(i+1);
		}
	}

	/**
	 * Set a DCA. Implicitly uses the DCA number in the object to determine the index.
	 * @param {DCA} dca 
	 */
	setDCA(dca) {
		// DCAs are numbered starting at 1
		this.dcas[dca.number - 1] = dca;
	}

	/**
	 * Get DCA
	 * @param {int} index 
	 * @returns {DCA} dca of that index
	 */
	getDCA(index) {
		if (index <= 0 || index > 8) {
			throw new Error("Invalid DCA number of " + index);
			return null;
		}

		// DCAs are numbered starting at 1
		return this.dcas[index - 1];
	}

	/**
	 * Fire cue, and send to board
	 * @async
	 */
	async send() {
		for (const dca in this.dcas) {
			dca.send();
		}
	}
}