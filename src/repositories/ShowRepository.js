import Actor from '../models/Actor';
import ActorGroup from '../models/ActorGroup';
import ActorProfile from '../models/ActorProfile';
import Position from '../models/Position';
import Cue from '../models/Cue';
import Ensemble from '../models/Ensemble';
import ShowFile from '../models/ShowFile';
import Profile from '../models/Profile';

class ShowRepository {

    constructor(database) {
        this.db = database;
    }

    load() {

        const show = new ShowFile();

        show.actors =
            this.db.all('SELECT * FROM actors')
                .map(x => new Actor(x));

        show.actorGroups =
            this.db.all('SELECT * FROM actorGroups')
                .map(x => new ActorGroup(x));

        show.actorProfiles =
            this.db.all('SELECT * FROM actorProfiles')
                .map(x => new ActorProfile(x));

        show.positions =
            this.db.all('SELECT * FROM positions')
                .map(x => new Position(x));

        show.profiles =
            this.db.all('SELECT * FROM profiles')
                .map(x => new Profile(x));

        show.ensembles =
            this.db.all('SELECT * FROM ensembles')
                .map(x => new Ensemble(x));

        show.cues =
            this.db.all('SELECT * FROM cues')
                .map(x => new Cue(x));

        const configRows =
            this.db.all('SELECT * FROM config');

        show.config = Object.fromEntries(
            configRows.map(row => [
                row.param,
                row.value
            ])
        );

        return show;
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