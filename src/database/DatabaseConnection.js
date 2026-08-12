import Database from "better-sqlite3";

class DatabaseConnection {
    constructor(filename) {
        this.db = new Database(filename);
    }

    all(sql, params = []) {
        return this.db.prepare(sql).all(params);
    }

    get(sql, params = []) {
        return this.db.prepare(sql).get(params);
    }

    run(sql, params = []) {
        return this.db.prepare(sql).run(params);
    }

    transaction(fn) {
        return this.db.transaction(fn);
    }
    
    close() {
        this.db.close();
    }
}

export default DatabaseConnection;
