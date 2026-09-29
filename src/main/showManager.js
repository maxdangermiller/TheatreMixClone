// main/showManager.js

import DatabaseConnection from '../database/DatabaseConnection';
import ShowRepository from '../repositories/ShowRepository';
import ShowFile from '../models/ShowFile';

let currentShow = null;

/**
 * Load Show
 * @param {String} path to show file
 * @returns {ShowFile} for loaded show
 */
function loadShow(path) {
	const db = new DatabaseConnection(path);

	const repo = new ShowRepository(db);

	currentShow = repo.load();

	db.close();

	return currentShow;
}

/**
 * Get Show
 * @returns {ShowFile} for loaded show
 */
function getShow() {
	return currentShow;
}

export {
	loadShow,
	getShow
};