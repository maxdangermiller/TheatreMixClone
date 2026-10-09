import Actor from '../models/Actor';
import ActorGroup from '../models/ActorGroup';
import ActorProfile from '../models/ActorProfile';
import Position from '../models/Position';
import Cue from '../models/Cue';
import Ensemble from '../models/Ensemble';
import ShowFile from '../models/ShowFile';
import Profile from '../models/Profile';
import Config from '../models/Config';

import { dca_level_key } from '../utils/dca_levels';

class ShowRepository {

    constructor(database) {
        this.db = database;
    }

    load() {

        const show = new ShowFile();;

        show.actors = this.db.all('SELECT * FROM actors').map(x => new Actor(x));

        show.actorGroups = this.db.all('SELECT * FROM actorGroups').map(x => new ActorGroup(x));

        show.actorProfiles = this.db.all('SELECT * FROM actorProfiles').map(x => new ActorProfile(x));

        show.positions = this.db.all('SELECT * FROM positions').map(x => new Position(x));

        show.profiles = this.db.all('SELECT * FROM profiles').map(x => new Profile(x));

        show.ensembles = this.db.all('SELECT * FROM ensembles').map(x => new Ensemble(x));

        show.cues = this.db.all('SELECT * FROM cues').map(x => new Cue(x));

        const configRows = this.db.all('SELECT * FROM config').map(x => new Config(x));

        show.config = Object.fromEntries(
            configRows.map(row => [
                row.param,
                row.value
            ])
        );

        show.dcaLevels = this.loadDcaLevels();

        show.consoleSetup = this.loadConsoleSetup();

        return show;
    }

    /**
     * Load per-cue DCA levels (only present in .tmixp files)
     * @returns {Object} { "number.point": { dca: level } }
     */
    loadDcaLevels() {

        const exists = this.db.get(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dcaLevels'"
        );

        if (!exists) {
            return {};
        }

        const levels = {};

        for (const row of this.db.all('SELECT number, point, dca, level FROM dcaLevels')) {
            const key = dca_level_key(row.number, row.point);

            levels[key] = levels[key] ?? {};
            levels[key][row.dca] = row.level;
        }

        return levels;
    }

    /**
     * Load StudioLive console setup (only present in .tmixp files).
     * Kept apart from TheatreMix's config so merging a .tmix doesn't overwrite it.
     * @returns {Object<string, string>} e.g. { muteButtonMap: "0=6,1=5" }
     */
    loadConsoleSetup() {

        const exists = this.db.get(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'consoleSetup'"
        );

        if (!exists) {
            return {};
        }

        return Object.fromEntries(
            this.db.all('SELECT param, value FROM consoleSetup').map((row) => [row.param, row.value ?? ""])
        );
    }

    /**
     * Replace the StudioLive console setup
     * @param {Object<string, string>} setup 
     */
    saveConsoleSetup(setup) {

        const save = this.db.transaction(() => {

            this.db.run(`
                CREATE TABLE IF NOT EXISTS consoleSetup (
                    param   TEXT PRIMARY KEY,
                    value   TEXT
                )
            `);

            this.db.run('DELETE FROM consoleSetup');

            for (const [param, value] of Object.entries(setup ?? {})) {
                this.db.run('INSERT INTO consoleSetup (param, value) VALUES (?, ?)', [param, value]);
            }
        });

        save();
    }

    /**
     * Replace all per-cue DCA levels
     * @param {Object} levels { "number.point": { dca: level } }
     */
    saveDcaLevels(levels) {

        const save = this.db.transaction(() => {

            this.db.run(`
                CREATE TABLE IF NOT EXISTS dcaLevels (
                    number  INTEGER NOT NULL,
                    point   INTEGER NOT NULL,
                    dca     INTEGER NOT NULL,
                    level   REAL    NOT NULL,
                    PRIMARY KEY (number, point, dca)
                )
            `);

            this.db.run('DELETE FROM dcaLevels');

            const stmt =
                this.db.db.prepare(
                    'INSERT INTO dcaLevels (number, point, dca, level) VALUES (?, ?, ?, ?)'
                );

            for (const [key, dcas] of Object.entries(levels)) {

                const [number, point] = key.split('.').map(Number);

                for (const [dca, level] of Object.entries(dcas)) {
                    stmt.run(number, point, Number(dca), level);
                }
            }
        });

        save();
    }

    saveConfig(show) {

        const save = this.db.transaction(() => {

            this.db.run('DELETE FROM config');

            Object.entries(show.config)
                .forEach(([param, value]) => {

                    this.db.run(
                        'INSERT INTO config(param,value) VALUES (?,?)',
                        [param, value]
                    );
                });
        });

        save();
    }

    saveActors(show) {

        const save = this.db.transaction(() => {

            this.db.run('DELETE FROM actors');

            const stmt =
                this.db.db.prepare(`
                    INSERT INTO actors
                    (
                        id,
                        channel,
                        name,
                        "order",
                        active
                    )
                    VALUES (?, ?, ?, ?, ?)
                `);

            for (const actor of show.actors) {

                stmt.run(
                    actor.id,
                    actor.channel,
                    actor.name,
                    actor.order,
                    actor.active
                );
            }
        });

        save();
    }

    saveCues(show) {

        const tx = this.db.transaction(() => {

            this.db.run('DELETE FROM cues');

            const columns =
                Object.keys(show.cues[0] || {});

            if (!columns.length) {
                return;
            }

            const placeholders =
                columns.map(() => '?').join(',');

            const sql =
                `
                INSERT INTO cues
                (${columns.join(',')})
                VALUES
                (${placeholders})
                `;

            const stmt =
                this.db.db.prepare(sql);

            for (const cue of show.cues) {

                stmt.run(
                    columns.map(c => cue[c])
                );
            }
        });

        tx();
    }
}

export default ShowRepository;