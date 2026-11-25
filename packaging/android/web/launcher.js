import { createAndroidReader } from './reader.js';
import { launchDestination, MARVEL_COMICS_URL } from '../js/lib/readerDestination.js';
import { appLaunchUrl } from '../js/lib/marvelComicsAppUrl.js';

window.opener = null;

const fallback = document.getElementById('fallback');
const disclosure = document.createElement('p');
disclosure.textContent = 'Comic links can open in the Marvel Comics app or your browser. Find on Marvel Comics opens the website.';
document.querySelector('.box').append(disclosure);

createAndroidReader({
  host: window,
  location: window.location,
  elements: {
    heading: document.getElementById('h'),
    status: document.getElementById('p'),
    fallback,
  },
  destination: launchDestination(),
  comicsUrl: MARVEL_COMICS_URL,
  appUrlFor: appLaunchUrl,
}).start();
