import BaseModel from './BaseModel';

class Cue extends BaseModel {

    get dcaAssignments() {
        return {
            dca01: this.parseChannelList(this.dca01Channels),
            dca02: this.parseChannelList(this.dca02Channels),
            dca03: this.parseChannelList(this.dca03Channels),
            dca04: this.parseChannelList(this.dca04Channels),
            dca05: this.parseChannelList(this.dca05Channels),
            dca06: this.parseChannelList(this.dca06Channels),
            dca07: this.parseChannelList(this.dca07Channels),
            dca08: this.parseChannelList(this.dca08Channels),
            dca09: this.parseChannelList(this.dca09Channels),
            dca10: this.parseChannelList(this.dca10Channels),
            dca11: this.parseChannelList(this.dca11Channels),
            dca12: this.parseChannelList(this.dca12Channels)
        };
    }

    parseChannelList(value) {
        if (!value) return [];

        return value
            .split(',')
            .map(v => parseInt(v, 10))
            .filter(v => !Number.isNaN(v));
    }
}

export default Cue;