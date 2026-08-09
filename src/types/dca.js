export default class DCA {

    /**
     * 
     * @param {int} number 
     * @param {int[]} channels 
     * @param {String} name 
     * @param {float} level 
     */
    constructor(number, channels, name, level) {
        this.number = number;
        this.channels = channels;
        this.name = name;
        this.level = level;
    }

    send() {
        await window.presonus.set_dta();
    } 
}