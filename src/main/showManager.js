// main/showManager.js

import DatabaseConnection from '../database/DatabaseConnection';
import ShowRepository from '../repositories/ShowRepository';

let currentShow = null;

function loadShow(path) {
	const db = new DatabaseConnection(path);

	const repo = new ShowRepository(db);

	currentShow = repo.load();

	db.close();

	return currentShow;
}

function getShow() {
	return currentShow;
}

module.exports = {
	loadShow,
	getShow
};