import Actor from "./Actor";
import ActorGroup from "./ActorGroup";
import ActorProfile from "./ActorProfile";
import Position from "./Position";
import Profile from "./Profile";
import Ensemble from "./Ensemble";
import Cue from "./Cue";
import Config from "./Config";



class ShowFile {
    /** @type {Actor[]} */
    actors;
    
    /** @type {ActorGroup[]} */
    actorGroups;

    /** @type {ActorGroup[]} */
    actorGroups;

    /** @type {ActorProfile[]} */
    actorProfiles;

    /** @type {Position[]} */
    positions;

    /** @type {Profile[]} */
    profiles;
    
    /** @type {Ensemble[]} */
    ensembles;

    /** @type {Cue[]} */
    cues;

    /** @type {Config} */
    config;

    /**
     * Per-cue DCA levels in dB (stored in .tmixp files)
     * @type {Object<string, Object<number, number>>} { "number.point": { dca: level } }
     */
    dcaLevels;

    constructor() {

        this.actors = [];
        this.actorGroups = [];
        this.actorProfiles = [];

        this.positions = [];
        this.profiles = [];
        this.ensembles = [];

        this.cues = [];

        this.config = {};

        this.dcaLevels = {};
    }
}

export default ShowFile;