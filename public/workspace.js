/* Workspace shell for index.html: hash router, mobile navigation drawer, the
   siteContent/home introduction and the projects/experiences records. No
   dependencies, no build step. Every Firestore string is rendered with
   textContent, never innerHTML, and every Firestore URL is parsed and
   protocol-checked before it reaches an href, src or iframe. */
import { db } from './firebase-config.js';
import { getDoc, getDocs, collection, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ---- Small helpers ----

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// Firestore fields are hand-authored and untyped: anything that is not a
// non-empty string (or list of them) is treated as missing.
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function lines(value) {
    return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

// An absolute URL with an allowed protocol, normalised, or '' — so
// javascript:, data: and relative paths never reach an href or iframe.
function externalUrl(value, protocols = ['https:', 'http:']) {
    const raw = text(value);
    if (!raw) return '';
    try {
        const url = new URL(raw);
        return protocols.includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

// ---- Routes ----

// Hash routes the workspace renders itself. `group` and `label` feed the
// header breadcrumb and the document title.
const VIEWS = {
    about: { group: 'Introduction', label: 'About' },
    contact: { group: 'Introduction', label: 'Contact' },
};

// The DS console's hash routes that the workspace does not render yet. Old
// shared links keep working by forwarding to the same screen in the
// preserved console page.
const LEGACY_ROUTES = new Set(['skills']);

const DEFAULT_ROUTE = 'about';

function currentRoute() {
    // Accepts both #about and #/about.
    return location.hash.replace(/^#\/?/, '') || DEFAULT_ROUTE;
}

// Record routes are <kind>/<Firestore document ID>. The ID is URI-encoded in
// the hash, so it is always the same string the sidebar link carries.
function routeKey(kind, id) {
    return `${kind}/${encodeURIComponent(id)}`;
}

function hrefFor(kind, id) {
    return `#${routeKey(kind, id)}`;
}

// { view: 'about' | 'contact' | 'notfound' } or { view: 'record', kind, id }.
// id is null for a bare #projects / #experience.
function parseRoute(raw) {
    // Own properties only, so #constructor, #toString etc. are not mistaken
    // for routes via Object.prototype.
    if (Object.hasOwn(VIEWS, raw)) return { view: raw };
    const slash = raw.indexOf('/');
    const kind = slash === -1 ? raw : raw.slice(0, slash);
    if (!Object.hasOwn(COLLECTIONS, kind)) return { view: 'notfound' };
    if (slash === -1) return { view: 'record', kind, id: null };
    let id;
    try {
        id = decodeURIComponent(raw.slice(slash + 1));
    } catch {
        return { view: 'notfound' }; // malformed percent-escape
    }
    return { view: 'record', kind, id: id || null };
}

const crumbGroup = document.getElementById('ws-crumb-group');
const crumbPage = document.getElementById('ws-crumb-page');
const views = document.querySelectorAll('.ws-view');

function render({ moveFocus }) {
    const raw = currentRoute();

    if (LEGACY_ROUTES.has(raw)) {
        // replace(), so Back does not bounce straight into this redirect.
        location.replace(`legacy.html#${raw}`);
        return;
    }

    const route = parseRoute(raw);

    // A bare #projects / #experience (old console links, the intro's
    // prompts) opens the first record. replaceState, not a new entry, so
    // Back returns to wherever the reader came from. Until the collection
    // has loaded, the record view shows its loading/empty/error state.
    if (route.view === 'record' && route.id === null) {
        const first = COLLECTIONS[route.kind].records[0];
        if (first) {
            history.replaceState(history.state, '', hrefFor(route.kind, first.id));
            route.id = first.id;
        }
    }

    const name = route.view;
    views.forEach(v => { v.hidden = v.dataset.view !== name; });

    let meta;
    if (name === 'record') {
        meta = renderRecord(route);
    } else {
        clearRecord();
        meta = Object.hasOwn(VIEWS, name)
            ? { ...VIEWS[name], navKey: name }
            : { group: 'Workspace', label: 'Not found', navKey: null };
    }

    // Queried each time: the project and experience links are rebuilt
    // whenever their collection loads.
    document.querySelectorAll('.ws-nav-link[data-route]').forEach(a => {
        if (a.dataset.route === meta.navKey) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
    });

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

// ---- Shared content helpers ----

// Firestore stores the avatar and every project screenshot as a GitHub blob
// URL for a file that already ships in public/assets/ (see legacy.html for
// the full history). Serve the local copy instead.
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

// Basenames with a .webp sibling in public/assets. Listed, not derived: a
// <source> naming a file that is not there would cost a 404. Same list as
// legacy.html.
const WEBP_ASSETS = new Set([
    'avatar.png', 'Console Shooting.png', 'Defusion Confusion.png',
    'Dungeon Maze.png', 'Eraser Escape.png', 'HorroSchool.png',
    'IEEE-Tech.png', "Jackson's Boba Beat.png",
]);

function isHttpUrl(value) {
    try {
        const { protocol } = new URL(value, document.baseURI);
        return protocol === 'https:' || protocol === 'http:';
    } catch {
        return false;
    }
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

function prose(value) {
    const box = el('div', 'ws-prose');
    renderProse(box, value);
    return box;
}

function bulletList(items) {
    const ul = el('ul', 'ws-list');
    items.forEach(item => ul.appendChild(el('li', null, item)));
    return ul;
}

// A status line with an optional "Try again" button.
function statusLine(message, onRetry) {
    const box = el('div', 'ws-status');
    box.setAttribute('role', 'status');
    box.appendChild(el('span', null, message));
    if (onRetry) {
        const retry = el('button', 'ws-text-btn', 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', onRetry);
        box.appendChild(retry);
    }
    return box;
}

// ---- Introduction content: siteContent/home ----

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

// ---- Records: projects and experiences ----

// Field names are exactly the ones admin.js writes. isRepoPublic defaults
// to true for documents saved before the field existed, as in admin.js.
function normalizeProject(id, d) {
    return {
        id,
        title: text(d.title),
        description: text(d.description),
        role: text(d.role),
        stack: lines(d.stack),
        learned: lines(d.learned),
        imageUrl: text(d.imageUrl),
        repoUrl: externalUrl(d.repoUrl),
        demoUrl: externalUrl(d.demoUrl),
        // Loaded in an iframe: https only, as admin.js enforces on save.
        playUrl: externalUrl(d.playUrl, ['https:']),
        repoPublic: d.isRepoPublic !== false,
        privateMessage: text(d.privateMessage),
        order: Number(d.order) || 0,
    };
}

function normalizeExperience(id, d) {
    return {
        id,
        role: text(d.role),
        company: text(d.company),
        location: text(d.location),
        dateRange: text(d.dateRange),
        achievements: lines(d.achievements),
        order: Number(d.order) || 0,
    };
}

// Keyed by the hash route's first segment. `path` is the Firestore
// collection. Sorted client-side by order, then name, then ID, as in
// legacy.html: several documents share the same order value.
const COLLECTIONS = {
    projects: {
        path: 'projects',
        group: 'Projects',
        noun: 'project',
        plural: 'projects',
        nav: document.getElementById('nav-projects-list'),
        navLabel: document.getElementById('nav-projects'),
        normalize: normalizeProject,
        name: r => r.title || 'Untitled project',
        build: buildProject,
        state: 'loading',
        records: [],
        byId: new Map(),
        version: 0,
    },
    experience: {
        path: 'experiences',
        group: 'Experience',
        noun: 'role',
        plural: 'experience',
        nav: document.getElementById('nav-experience-list'),
        navLabel: document.getElementById('nav-experience'),
        normalize: normalizeExperience,
        name: r => r.role || 'Untitled role',
        build: buildExperience,
        state: 'loading',
        records: [],
        byId: new Map(),
        version: 0,
    },
};

async function loadCollection(kind) {
    const c = COLLECTIONS[kind];
    const version = ++c.version; // a newer retry supersedes this load
    c.state = 'loading';
    refreshCollection(kind);
    try {
        const snap = await getDocs(collection(db, c.path));
        if (version !== c.version) return;
        const records = snap.docs.map(s => c.normalize(s.id, s.data()));
        records.sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            const nameA = c.name(a);
            const nameB = c.name(b);
            if (nameA !== nameB) return nameA < nameB ? -1 : 1;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        c.records = records;
        c.byId = new Map(records.map(r => [r.id, r]));
        c.state = 'ready';
    } catch (err) {
        if (version !== c.version) return;
        console.error(`Error loading ${c.path}:`, err);
        c.records = [];
        c.byId = new Map();
        c.state = 'error';
    }
    refreshCollection(kind);
}

function refreshCollection(kind) {
    renderNav(kind);
    render({ moveFocus: false });
}

// ---- Sidebar record links ----

function navNote(message) {
    return el('li', 'ws-nav-note', message);
}

// Outline icons drawn on a 24-unit grid; stroke follows the link colour.
const SVG_NS = 'http://www.w3.org/2000/svg';
const NAV_ICON_PATHS = {
    projects: [
        'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
    ],
    experience: [
        'M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z',
        'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
        'M2 13h20',
    ],
};

function navIcon(kind) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ws-nav-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    NAV_ICON_PATHS[kind].forEach(d => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    });
    return svg;
}

function renderNav(kind) {
    const c = COLLECTIONS[kind];
    const hadFocus = c.nav.contains(document.activeElement);
    const items = [];

    if (c.state === 'loading') {
        items.push(navNote('Loading…'));
    } else if (c.state === 'error') {
        const note = navNote(`Couldn't load ${c.plural}.`);
        const retry = el('button', 'ws-text-btn ws-text-btn-sm', 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', () => loadCollection(kind));
        note.appendChild(retry);
        items.push(note);
    } else if (!c.records.length) {
        items.push(navNote(`No ${c.plural} yet.`));
    } else {
        c.records.forEach(r => {
            const a = el('a', 'ws-nav-link ws-nav-link-record');
            a.href = hrefFor(kind, r.id);
            a.dataset.route = routeKey(kind, r.id);
            a.appendChild(navIcon(kind));
            a.appendChild(el('span', 'ws-nav-text', c.name(r)));
            // Experience shows the company under the role. The hidden comma
            // keeps the two apart in the link's accessible name.
            if (kind === 'experience' && r.company) {
                const sub = el('span', 'ws-nav-sub');
                sub.append(el('span', 'ws-sr', ', '), r.company);
                a.appendChild(sub);
            }
            const li = el('li');
            li.appendChild(a);
            items.push(li);
        });
    }

    c.nav.replaceChildren(...items);

    // Rebuilding under the keyboard (e.g. "Try again" inside the drawer)
    // must not drop focus to <body>, which would escape the focus trap.
    if (hadFocus) {
        const target = c.nav.querySelector('a, button') || c.navLabel;
        target.focus();
    }
}

// ---- Record view ----

const recordView = document.getElementById('view-record');
const resourcesContext = document.getElementById('ws-resources-context');

// Pointer capability, as in legacy.html: playable builds need reliable
// keyboard/mouse input and are not offered on touch-first devices.
const canPlay = !window.matchMedia('(pointer: coarse)').matches;

// Identifies what the record view currently shows, so re-rendering the same
// route (a drawer link to the open page, a sibling collection loading) does
// not rebuild it and kill a running game.
let recordKey = null;

function clearRecord() {
    if (recordKey === null) return;
    recordKey = null;
    // Navigate any game away before removing it, so its document and wasm
    // heap are discarded now rather than whenever GC gets to them.
    recordView.querySelectorAll('iframe').forEach(f => { f.src = 'about:blank'; });
    recordView.replaceChildren();
    resourcesContext.replaceChildren();
    resourcesContext.hidden = true;
}

function renderRecord({ kind, id }) {
    const c = COLLECTIONS[kind];
    const record = id === null ? null : c.byId.get(id) || null;

    let label;
    if (record) label = c.name(record);
    else if (c.state === 'loading') label = 'Loading…';
    else if (c.state === 'error') label = "Couldn't load";
    else if (!c.records.length) label = `No ${c.plural} yet`;
    else label = 'Not found';

    const key = `${kind}\n${id}\n${c.state}\n${c.version}`;
    if (key !== recordKey) {
        const hadFocus = recordView.contains(document.activeElement);
        clearRecord();
        recordKey = key;

        if (record) c.build(record);
        else if (c.state === 'loading') buildLoading(c);
        else if (c.state === 'error') buildError(kind);
        else if (!c.records.length) buildEmpty(c);
        else buildMissing(kind);

        if (!resourcesContext.hasChildNodes()) resourcesContext.hidden = true;
        // e.g. "Try again" was pressed inside the view being rebuilt.
        if (hadFocus) recordView.querySelector('.ws-view-heading').focus({ preventScroll: true });
    }

    return { group: c.group, label, navKey: record ? routeKey(kind, record.id) : null };
}

function recordHeader(eyebrow, title, lede) {
    const head = el('header', 'ws-record-head');
    head.appendChild(el('p', 'ws-eyebrow', eyebrow));
    const h1 = el('h1', 'ws-view-heading', title);
    h1.id = 'record-heading';
    h1.tabIndex = -1;
    head.appendChild(h1);
    if (lede) head.appendChild(el('p', 'ws-lede', lede));
    return head;
}

// One exchange: the question a reader would ask, as a right-aligned bubble
// heading, and the authored answer below it. The questions are section
// headings, not invented dialogue; every answer is a Firestore field.
function turn(question, ...answer) {
    const section = el('section', 'ws-turn');
    section.appendChild(el('h2', 'ws-turn-q', question));
    const reply = el('div', 'ws-turn-a');
    reply.append(...answer);
    section.appendChild(reply);
    return section;
}

// "Where to next": the following record in sidebar order, then the other
// collection and contact.
function nextPrompts(kind, id) {
    const c = COLLECTIONS[kind];
    const links = [];
    const i = c.records.findIndex(r => r.id === id);
    if (c.records.length > 1 && i !== -1) {
        const next = c.records[(i + 1) % c.records.length];
        links.push([hrefFor(kind, next.id), `Next ${c.noun}: ${c.name(next)}`]);
    }
    if (kind === 'projects') links.push(['#experience', 'Where have you worked?']);
    else links.push(['#projects', 'What have you built?']);
    links.push(['#contact', 'How can I reach you?']);

    const box = el('div', 'ws-prompts');
    const label = el('h2', 'ws-section-label', 'Where to next');
    label.id = 'record-prompts-label';
    const ul = el('ul', 'ws-prompt-list');
    ul.setAttribute('aria-labelledby', label.id);
    links.forEach(([href, title]) => {
        const a = el('a', 'ws-prompt', title);
        a.href = href;
        const li = el('li');
        li.appendChild(a);
        ul.appendChild(li);
    });
    box.append(label, ul);
    return box;
}

function resourceSection(title, content) {
    resourcesContext.append(el('h3', 'ws-section-label', title), content);
    resourcesContext.hidden = false;
}

// An outbound resource link with its host underneath, so the reader can see
// where it goes. `url` has already been through externalUrl().
function resourceLink(label, url) {
    const a = el('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.appendChild(el('span', 'ws-resource-name', label));
    a.appendChild(el('span', 'ws-resource-host', new URL(url).hostname.replace(/^www\./, '')));
    const li = el('li');
    li.appendChild(a);
    return li;
}

function buildLoading(c) {
    recordView.setAttribute('aria-busy', 'true');
    const head = recordHeader(c.group, 'Loading…');
    head.querySelector('h1').classList.add('ws-loading');
    const sk = el('div', 'ws-prose');
    sk.setAttribute('aria-hidden', 'true');
    sk.append(el('p', 'ws-skeleton'), el('p', 'ws-skeleton ws-skeleton-short'));
    recordView.append(head, sk);
}

function buildError(kind) {
    const c = COLLECTIONS[kind];
    recordView.removeAttribute('aria-busy');
    recordView.append(
        recordHeader(c.group, `Couldn't load ${c.plural}`),
        statusLine('The connection to the portfolio database failed.', () => loadCollection(kind)),
    );
}

function buildEmpty(c) {
    recordView.removeAttribute('aria-busy');
    recordView.append(recordHeader(c.group, `No ${c.plural} yet`,
        `Nothing has been added to ${c.group} yet.`));
}

function buildMissing(kind) {
    const c = COLLECTIONS[kind];
    recordView.removeAttribute('aria-busy');
    const first = c.records[0];
    const back = el('p');
    const a = el('a', 'ws-prompt', `Open ${c.name(first)}`);
    a.href = hrefFor(kind, first.id);
    back.appendChild(a);
    recordView.append(
        recordHeader(c.group, `This ${c.noun} isn't here`,
            'It may have been removed, or the link is out of date.'),
        back,
    );
}

// ---- Project ----

// The screenshot as a <figure>, or null when there is no usable URL. GitHub
// blob URLs resolve to the bundled copy (and its WebP); any other absolute
// http(s) URL is used as is. A failed load hides the figure rather than
// leaving a broken-image box.
function screenshot(title, url) {
    const file = assetBasename(url);
    let src = '';
    let webp = '';
    if (file) {
        src = `assets/${encodeURIComponent(file)}`;
        if (WEBP_ASSETS.has(file)) webp = `assets/${encodeURIComponent(file.replace(/\.png$/, '.webp'))}`;
    } else {
        src = externalUrl(url);
    }
    if (!src) return null;

    const figure = el('figure', 'ws-figure');
    const img = el('img');
    img.alt = `${title} — screenshot`;
    img.decoding = 'async';
    img.addEventListener('error', () => { figure.hidden = true; }, { once: true });
    if (webp) {
        // Source first, src last, so the WebP is the only file requested.
        const picture = el('picture');
        const source = el('source');
        source.srcset = webp;
        source.type = 'image/webp';
        picture.append(source, img);
        figure.appendChild(picture);
    } else {
        figure.appendChild(img);
    }
    img.src = src;
    return figure;
}

// The playable build, loaded only when asked for: it is a full game (wasm,
// audio), far too heavy to start on page load.
function playControl(p, title) {
    const box = el('div', 'ws-play');
    if (!canPlay) {
        box.appendChild(el('p', 'ws-empty',
            'The playable build needs a keyboard and mouse, so it is offered in desktop browsers.'));
        return box;
    }
    const start = el('button', 'ws-text-btn', 'Play in browser');
    start.type = 'button';
    start.addEventListener('click', () => {
        const frame = el('iframe', 'ws-play-frame');
        frame.title = `${title} — playable build`;
        frame.allow = 'autoplay; fullscreen; gamepad';
        frame.allowFullscreen = true;
        frame.src = p.playUrl;

        const stop = el('button', 'ws-text-btn', 'Close game');
        stop.type = 'button';
        stop.addEventListener('click', () => {
            frame.src = 'about:blank';
            frame.remove();
            stop.remove();
            start.hidden = false;
            start.focus();
        });

        start.hidden = true;
        box.append(frame, stop);
        frame.focus();
    });
    box.appendChild(start);
    return box;
}

function buildProject(p) {
    recordView.removeAttribute('aria-busy');
    const title = COLLECTIONS.projects.name(p);
    const parts = [recordHeader('Project', title)];

    const overview = [];
    const figure = p.imageUrl ? screenshot(title, p.imageUrl) : null;
    if (figure) overview.push(figure);
    if (p.description) overview.push(prose(p.description));
    if (overview.length) parts.push(turn('What is it?', ...overview));
    if (p.role) parts.push(turn('What was your role?', prose(p.role)));
    if (p.learned.length) parts.push(turn('What did you learn?', bulletList(p.learned)));
    if (p.playUrl) parts.push(turn('Can I try it?', playControl(p, title)));
    if (parts.length === 1) {
        parts.push(el('p', 'ws-empty', 'No details have been written for this project yet.'));
    }
    parts.push(nextPrompts('projects', p.id));
    recordView.append(...parts);

    // Resources: repository (or its confidentiality note), demo, stack.
    const links = el('ul', 'ws-resource-list');
    if (p.repoPublic && p.repoUrl) {
        links.appendChild(resourceLink('Source code', p.repoUrl));
    } else if (!p.repoPublic) {
        // A private repository is not missing data: it is the note.
        const li = el('li', 'ws-resource-note');
        li.appendChild(el('span', 'ws-resource-name', 'Source code is private'));
        li.appendChild(el('span', 'ws-resource-host',
            p.privateMessage || 'Due to security regulations, the code is kept confidential.'));
        links.appendChild(li);
    }
    if (p.demoUrl) links.appendChild(resourceLink('Demo video', p.demoUrl));
    if (links.hasChildNodes()) resourceSection('This project', links);

    if (p.stack.length) {
        const chips = el('ul', 'ws-chip-list');
        p.stack.forEach(s => chips.appendChild(el('li', 'ws-chip', s)));
        resourceSection('Built with', chips);
    }
}

// ---- Experience ----

function buildExperience(x) {
    recordView.removeAttribute('aria-busy');
    const head = recordHeader('Experience', COLLECTIONS.experience.name(x), x.company);
    const facts = [x.dateRange, x.location].filter(Boolean);
    if (facts.length) {
        const meta = el('p', 'ws-meta');
        facts.forEach(f => meta.appendChild(el('span', null, f)));
        head.appendChild(meta);
    }
    const parts = [head];
    parts.push(x.achievements.length
        ? turn('What did you work on?', bulletList(x.achievements))
        : el('p', 'ws-empty', 'No details have been written for this role yet.'));
    parts.push(nextPrompts('experience', x.id));
    recordView.append(...parts);

    const dl = el('dl', 'ws-facts');
    [['Company', x.company], ['Location', x.location], ['Dates', x.dateRange]].forEach(([k, v]) => {
        if (!v) return;
        dl.append(el('dt', null, k), el('dd', null, v));
    });
    if (dl.hasChildNodes()) resourceSection('This role', dl);
}

// ---- Start ----

loadHome();
render({ moveFocus: false });
loadCollection('projects');
loadCollection('experience');
