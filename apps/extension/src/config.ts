import { LOCAL_API_URL, LOCAL_WEB_URL } from '../origins.js';

export const API_URL = import.meta.env.WXT_API_URL ?? LOCAL_API_URL;
export const WEB_URL = import.meta.env.WXT_WEB_URL ?? LOCAL_WEB_URL;

export const OFFSCREEN_PATH = '/offscreen.html';
