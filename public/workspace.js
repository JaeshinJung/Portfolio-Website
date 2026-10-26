/* Workspace shell for index.html: hash router, mobile navigation drawer and
   the siteContent/home introduction. No dependencies, no build step. Every
   Firestore string is rendered with textContent, never innerHTML. */
import { db } from './firebase-config.js';
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ---- Routes ----

// Hash routes the workspace renders itself. `group` and `label` feed the
// header breadcrumb and the document title.
const VIEWS = {
    about: { group: 'Introduction', label: 'About' },
    contact: { group: 'Introduction', label: 'Contact' },
};

// The DS console's hash routes that the workspace does not render yet. Old
// shared links (/#projects etc.) keep working by forwarding to the same
// screen in the preserved console page.
const LEGACY_ROUTES = new Set(['projects', 'experience', 'skills']);

const DEFAULT_ROUTE = 'about';

function currentRoute() {
    // Accepts both #about and #/about.
    return location.hash.replace(/^#\/?/, '') || DEFAULT_ROUTE;
}

const crumbGroup = document.getElementById('ws-crumb-group');
const crumbPage = document.getElementById('ws-crumb-page');
const views = document.querySelectorAll('.ws-view');
const navLinks = document.querySelectorAll('.ws-nav-link[data-route]');

function render({ moveFocus }) {
    const route = currentRoute();

    if (LEGACY_ROUTES.has(route)) {
        // replace(), so Back does not bounce straight into this redirect.
        location.replace(`legacy.html#${route}`);
        return;
    }

    // Own properties only, so #constructor, #toString etc. are not mistaken
    // for routes via Object.prototype.
    const isView = Object.hasOwn(VIEWS, route);
    const name = isView ? route : 'notfound';
    views.forEach(v => { v.hidden = v.dataset.view !== name; });

    navLinks.forEach(a => {
        if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
    });

    const meta = isView ? VIEWS[name] : { group: 'Workspace', label: 'Not found' };
    crumbGroup.textContent = meta.group;
    crumbPage.textContent = meta.label;
    document.title = `${meta.label} · Jae — Jaeshin Jung`;

    // Only on in-page navigation: on first load the browser's own focus
    // position (top of document) is the right one.
    if (moveFocus) {
        const heading = document.querySelector(`[data-view="${name}"] .ws-view-heading`);
        if (heading) heading.focus({ preventScroll: true });
        window.scrollTo(0, 0);
    }
}

window.addEventListener('hashchange', () => render({ moveFocus: true }));

// The skip link targets #ws-main, which the router would otherwise treat as
// an unknown route.
document.getElementById('ws-skip').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('ws-main').focus();
});

// ---- Mobile navigation drawer ----

const sidebar = document.getElementById('ws-sidebar');
const menuBtn = document.getElementById('ws-menu-btn');
const closeBtn = document.getElementById('ws-drawer-close');
const backdrop = document.getElementById('ws-backdrop');
const body = document.getElementById('ws-body');
const skip = document.getElementById('ws-skip');

// Must match the drawer breakpoint in workspace.css.
const drawerQuery = window.matchMedia('(max-width: 899.98px)');

let drawerOpen = false;

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables() {
    return [...sidebar.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
}

function openDrawer() {
    if (drawerOpen) return;
    drawerOpen = true;
    sidebar.classList.add('is-open');
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    sidebar.setAttribute('aria-label', 'Site navigation');
    menuBtn.setAttribute('aria-expanded', 'true');
    backdrop.hidden = false;
    body.inert = true;
    skip.inert = true;
    document.documentElement.classList.add('ws-drawer-open');
    // Land on the current page's link when there is one, so the open drawer
    // starts where the reader already is.
    const target = sidebar.querySelector('.ws-nav-link[aria-current="page"]') || focusables()[0];
    if (target) target.focus();
}

function closeDrawer({ restoreFocus }) {
    if (!drawerOpen) return;
    drawerOpen = false;
    sidebar.classList.remove('is-open');
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    sidebar.removeAttribute('aria-label');
    menuBtn.setAttribute('aria-expanded', 'false');
    backdrop.hidden = true;
    body.inert = false;
    skip.inert = false;
    document.documentElement.classList.remove('ws-drawer-open');
    if (restoreFocus) menuBtn.focus();
}

menuBtn.addEventListener('click', openDrawer);
closeBtn.addEventListener('click', () => closeDrawer({ restoreFocus: true }));
backdrop.addEventListener('click', () => closeDrawer({ restoreFocus: true }));

sidebar.addEventListener('keydown', e => {
    if (!drawerOpen) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeDrawer({ restoreFocus: true });
        return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});

// Choosing a workspace link closes the drawer; render() then moves focus to
// the new view's heading. Same-page links fire no hashchange, so focus the
// heading here. Links to legacy.html leave the page and need nothing.
sidebar.addEventListener('click', e => {
    const link = e.target.closest('a[href^="#"]');
    if (!link || !drawerOpen) return;
    const sameRoute = link.getAttribute('href').replace(/^#\/?/, '') === currentRoute();
    closeDrawer({ restoreFocus: false });
    if (sameRoute) render({ moveFocus: true });
});

// Widening past the breakpoint turns the drawer back into a static column.
drawerQuery.addEventListener('change', e => {
    if (!e.matches) closeDrawer({ restoreFocus: false });
});

// ---- Introduction content: siteContent/home ----

// Firestore stores the avatar as a GitHub blob URL for a file that already
// ships in public/assets/ (see legacy.html for the full history). Keep the
// local copy the markup already loaded rather than fetching it again.
const GITHUB_ASSET_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/public\/assets\/([^/?#]+)(?:[?#]|$)/;

function assetBasename(url) {
    const match = GITHUB_ASSET_URL.exec(url);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return null;
    }
}

function isHttpUrl(value) {
    try {
        const { protocol } = new URL(value, document.baseURI);
        return protocol === 'https:' || protocol === 'http:';
    } catch {
        return false;
    }
}

function setProfileImage(url) {
    const img = document.getElementById('home-img');
    if (assetBasename(url) === 'avatar.png') return; // already showing it
    if (!isHttpUrl(url)) return;
    // The static <source> names the bundled avatar; drop it so the new src
    // is the only candidate.
    const picture = img.parentElement;
    if (picture && picture.tagName === 'PICTURE') {
        picture.querySelectorAll('source').forEach(s => s.remove());
    }
    img.src = url;
}

// Blank lines separate paragraphs; single newlines stay line breaks.
function renderProse(container, text) {
    container.replaceChildren();
    text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).forEach(para => {
        const p = document.createElement('p');
        para.split('\n').forEach((line, i) => {
            if (i) p.appendChild(document.createElement('br'));
            p.appendChild(document.createTextNode(line));
        });
        container.appendChild(p);
    });
}

const homeTitle = document.getElementById('home-title');
const homeSubtitle = document.getElementById('home-subtitle');
const homeAbout = document.getElementById('home-about');
const homeStatus = document.getElementById('home-status');

// The same fallbacks the console page used when the document is missing.
const FALLBACK_TITLE = 'Jaeshin Jung';
const FALLBACK_SUBTITLE = 'Computer Science @ Texas A&M University';

function showStatus(message, withRetry) {
    homeStatus.replaceChildren();
    const text = document.createElement('span');
    text.textContent = message;
    homeStatus.appendChild(text);
    if (withRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'ws-text-btn';
        retry.textContent = 'Try again';
        retry.addEventListener('click', loadHome);
        homeStatus.appendChild(retry);
    }
    homeStatus.hidden = false;
}

function finishLoading() {
    homeTitle.classList.remove('ws-loading');
    homeSubtitle.classList.remove('ws-loading');
    homeAbout.removeAttribute('aria-busy');
}

async function loadHome() {
    homeStatus.hidden = true;
    homeAbout.setAttribute('aria-busy', 'true');
    try {
        const snap = await getDoc(doc(db, 'siteContent', 'home'));
        const data = snap.exists() ? snap.data() : {};

        homeTitle.textContent = typeof data.heroTitle === 'string' && data.heroTitle.trim()
            ? data.heroTitle : FALLBACK_TITLE;
        homeSubtitle.textContent = typeof data.heroSubtitle === 'string' && data.heroSubtitle.trim()
            ? data.heroSubtitle : FALLBACK_SUBTITLE;
        if (typeof data.profileImageUrl === 'string' && data.profileImageUrl) {
            setProfileImage(data.profileImageUrl);
        }

        if (typeof data.aboutMeText === 'string' && data.aboutMeText.trim()) {
            renderProse(homeAbout, data.aboutMeText);
        } else {
            homeAbout.replaceChildren();
            const empty = document.createElement('p');
            empty.className = 'ws-empty';
            empty.textContent = 'No introduction has been written yet.';
            homeAbout.appendChild(empty);
        }
    } catch (err) {
        console.error('Error loading home:', err);
        homeTitle.textContent = FALLBACK_TITLE;
        homeSubtitle.textContent = FALLBACK_SUBTITLE;
        homeAbout.replaceChildren();
        showStatus("Couldn't load the introduction.", true);
    } finally {
        finishLoading();
    }
}

loadHome();
render({ moveFocus: false });
