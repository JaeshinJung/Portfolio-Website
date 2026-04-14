// admin.js — Firebase Auth + Firestore CRUD for Admin Dashboard

import { db, auth } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    collection, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, query, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ─── DOM References ──────────────────────────────
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const userEmailEl = document.getElementById('user-email');
const toastEl = document.getElementById('toast');

// ─── Auth State ──────────────────────────────────
onAuthStateChanged(auth, user => {
    if (user) {
        loginView.style.display = 'none';
        dashboardView.style.display = 'block';
        userEmailEl.textContent = user.email;
        userEmailEl.textContent = user.email;
        loadHome();
        loadProjects();
        loadExperiences();
        loadSkills();
    } else {
        loginView.style.display = 'flex';
        dashboardView.style.display = 'none';
    }
});

// ─── Login ───────────────────────────────────────
loginBtn.addEventListener('click', async () => {
    loginError.textContent = '';
    const email = loginEmail.value.trim();
    const pw = loginPassword.value;
    if (!email || !pw) { loginError.textContent = 'Fill in all fields.'; return; }
    try {
        await signInWithEmailAndPassword(auth, email, pw);
    } catch (e) {
        loginError.textContent = 'Login failed: ' + e.message;
    }
});

loginPassword.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginBtn.click();
});

// ─── Logout ──────────────────────────────────────
logoutBtn.addEventListener('click', () => signOut(auth));

// ─── Tabs ────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

// ─── Toast ───────────────────────────────────────
function showToast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => { toastEl.className = 'toast'; }, 2500);
}

// ─── Escape HTML ─────────────────────────────────
function esc(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// ============================================================
// PROJECTS CRUD
// ============================================================
const projTitle = document.getElementById('proj-title');
const projImage = document.getElementById('proj-image');
const projRepo = document.getElementById('proj-repo');
const projDemo = document.getElementById('proj-demo');
const projDesc = document.getElementById('proj-desc');
const projOrder = document.getElementById('proj-order');
const projEditId = document.getElementById('project-edit-id');
const projFormTitle = document.getElementById('project-form-title');
const projSaveBtn = document.getElementById('proj-save-btn');
const projCancelBtn = document.getElementById('proj-cancel-btn');
const projListEl = document.getElementById('proj-list');
const projIsPublic = document.getElementById('proj-is-public');
const projRepoContainer = document.getElementById('proj-repo-container');
const projPrivateContainer = document.getElementById('proj-private-container');
const projPrivateMsg = document.getElementById('proj-private-msg');

// Toggle repo URL / private message visibility based on checkbox
projIsPublic.addEventListener('change', () => {
    if (projIsPublic.checked) {
        projRepoContainer.style.display = '';
        projPrivateContainer.style.display = 'none';
    } else {
        projRepoContainer.style.display = 'none';
        projPrivateContainer.style.display = '';
    }
});

async function loadProjects() {
    const q = query(collection(db, 'projects'), orderBy('order', 'asc'));
    const snap = await getDocs(q);
    projListEl.innerHTML = '';
    if (snap.empty) {
        projListEl.innerHTML = '<p class="empty-state">No projects yet.</p>';
        return;
    }
    snap.forEach(docSnap => {
        const d = docSnap.data();
        const item = document.createElement('div');
        item.className = 'admin-item';
        item.innerHTML = `
            <div class="admin-item-info">
                <h4>${esc(d.title || 'Untitled')}</h4>
                <p>${esc(d.description || '')}</p>
            </div>
            <div class="admin-item-actions">
                <button class="pixel-btn secondary btn-sm" data-edit="${docSnap.id}">Edit</button>
                <button class="pixel-btn danger btn-sm" data-del="${docSnap.id}">Del</button>
            </div>
        `;
        // Edit
        item.querySelector('[data-edit]').addEventListener('click', () => {
            projEditId.value = docSnap.id;
            projTitle.value = d.title || '';
            projImage.value = d.imageUrl || '';
            projRepo.value = d.repoUrl || '';
            projDemo.value = d.demoUrl || '';
            projDesc.value = d.description || '';
            projOrder.value = d.order ?? 0;

            // Populate public/private repo fields
            const isPublic = d.isRepoPublic !== false; // default true for old data
            projIsPublic.checked = isPublic;
            projPrivateMsg.value = d.privateMessage || 'Due to security regulations, the code is kept confidential.';
            projRepoContainer.style.display = isPublic ? '' : 'none';
            projPrivateContainer.style.display = isPublic ? 'none' : '';

            projFormTitle.textContent = '✎ Edit Project';
            projCancelBtn.style.display = 'inline-block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        // Delete
        item.querySelector('[data-del]').addEventListener('click', async () => {
            if (!confirm('Delete this project?')) return;
            await deleteDoc(doc(db, 'projects', docSnap.id));
            showToast('Project deleted');
            loadProjects();
        });
        projListEl.appendChild(item);
    });
}

projSaveBtn.addEventListener('click', async () => {
    const data = {
        title: projTitle.value.trim(),
        imageUrl: projImage.value.trim(),
        repoUrl: projRepo.value.trim(),
        demoUrl: projDemo.value.trim(),
        description: projDesc.value.trim(),
        order: parseInt(projOrder.value) || 0,
        isRepoPublic: projIsPublic.checked,
        privateMessage: projPrivateMsg.value.trim()
    };
    if (!data.title) { showToast('Title required', true); return; }

    try {
        if (projEditId.value) {
            await updateDoc(doc(db, 'projects', projEditId.value), data);
            showToast('Project updated');
        } else {
            await addDoc(collection(db, 'projects'), data);
            showToast('Project added');
        }
        resetProjectForm();
        loadProjects();
    } catch (e) {
        showToast('Error: ' + e.message, true);
    }
});

projCancelBtn.addEventListener('click', resetProjectForm);

function resetProjectForm() {
    projEditId.value = '';
    projTitle.value = '';
    projImage.value = '';
    projRepo.value = '';
    projDemo.value = '';
    projDesc.value = '';
    projOrder.value = '0';
    projIsPublic.checked = true;
    projPrivateMsg.value = 'Due to security regulations, the code is kept confidential.';
    projRepoContainer.style.display = '';
    projPrivateContainer.style.display = 'none';
    projFormTitle.textContent = '+ Add Project';
    projCancelBtn.style.display = 'none';
}

// ============================================================
// EXPERIENCE CRUD
// ============================================================
const expRole = document.getElementById('exp-role');
const expCompany = document.getElementById('exp-company');
const expLocation = document.getElementById('exp-location');
const expDate = document.getElementById('exp-date');
const expAchievements = document.getElementById('exp-achievements');
const expOrder = document.getElementById('exp-order');
const expEditId = document.getElementById('exp-edit-id');
const expFormTitle = document.getElementById('exp-form-title');
const expSaveBtn = document.getElementById('exp-save-btn');
const expCancelBtn = document.getElementById('exp-cancel-btn');
const expListEl = document.getElementById('exp-list');

async function loadExperiences() {
    const q = query(collection(db, 'experiences'), orderBy('order', 'asc'));
    const snap = await getDocs(q);
    expListEl.innerHTML = '';
    if (snap.empty) {
        expListEl.innerHTML = '<p class="empty-state">No experience entries yet.</p>';
        return;
    }
    snap.forEach(docSnap => {
        const d = docSnap.data();
        const item = document.createElement('div');
        item.className = 'admin-item';
        item.innerHTML = `
            <div class="admin-item-info">
                <h4>${esc(d.role || 'Untitled')}</h4>
                <p>${esc(d.company || '')} | ${esc(d.dateRange || '')}</p>
            </div>
            <div class="admin-item-actions">
                <button class="pixel-btn secondary btn-sm" data-edit="${docSnap.id}">Edit</button>
                <button class="pixel-btn danger btn-sm" data-del="${docSnap.id}">Del</button>
            </div>
        `;
        item.querySelector('[data-edit]').addEventListener('click', () => {
            expEditId.value = docSnap.id;
            expRole.value = d.role || '';
            expCompany.value = d.company || '';
            expLocation.value = d.location || '';
            expDate.value = d.dateRange || '';
            expAchievements.value = (d.achievements || []).join('\n');
            expOrder.value = d.order ?? 0;
            expFormTitle.textContent = '✎ Edit Experience';
            expCancelBtn.style.display = 'inline-block';
            // Switch tab
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector('[data-tab="experiences-tab"]').classList.add('active');
            document.getElementById('experiences-tab').classList.add('active');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        item.querySelector('[data-del]').addEventListener('click', async () => {
            if (!confirm('Delete this experience?')) return;
            await deleteDoc(doc(db, 'experiences', docSnap.id));
            showToast('Experience deleted');
            loadExperiences();
        });
        expListEl.appendChild(item);
    });
}

expSaveBtn.addEventListener('click', async () => {
    const data = {
        role: expRole.value.trim(),
        company: expCompany.value.trim(),
        location: expLocation.value.trim(),
        dateRange: expDate.value.trim(),
        achievements: expAchievements.value.split('\n').map(s => s.trim()).filter(Boolean),
        order: parseInt(expOrder.value) || 0
    };
    if (!data.role) { showToast('Role required', true); return; }

    try {
        if (expEditId.value) {
            await updateDoc(doc(db, 'experiences', expEditId.value), data);
            showToast('Experience updated');
        } else {
            await addDoc(collection(db, 'experiences'), data);
            showToast('Experience added');
        }
        resetExpForm();
        loadExperiences();
    } catch (e) {
        showToast('Error: ' + e.message, true);
    }
});

expCancelBtn.addEventListener('click', resetExpForm);

function resetExpForm() {
    expEditId.value = '';
    expRole.value = '';
    expCompany.value = '';
    expLocation.value = '';
    expDate.value = '';
    expAchievements.value = '';
    expOrder.value = '0';
    expFormTitle.textContent = '+ Add Experience';
    expCancelBtn.style.display = 'none';
}

// ============================================================
// HOME CONTENT
// ============================================================
const homeHeroTitle = document.getElementById('home-hero-title');
const homeHeroSubtitle = document.getElementById('home-hero-subtitle');
const homeProfileImg = document.getElementById('home-profile-img');
const homeAboutMe = document.getElementById('home-about-me');
const homeSaveBtn = document.getElementById('home-save-btn');

async function loadHome() {
    try {
        const homeDoc = await getDoc(doc(db, 'siteContent', 'home'));
        if (homeDoc.exists()) {
            const data = homeDoc.data();
            homeHeroTitle.value = data.heroTitle || '';
            homeHeroSubtitle.value = data.heroSubtitle || '';
            homeProfileImg.value = data.profileImageUrl || '';
            homeAboutMe.value = data.aboutMeText || '';
        }
    } catch(e) {
        showToast('Failed to load home data', true);
    }
}

homeSaveBtn.addEventListener('click', async () => {
    const data = {
        heroTitle: homeHeroTitle.value.trim(),
        heroSubtitle: homeHeroSubtitle.value.trim(),
        profileImageUrl: homeProfileImg.value.trim(),
        aboutMeText: homeAboutMe.value.trim()
    };
    
    try {
        await setDoc(doc(db, 'siteContent', 'home'), data, { merge: true });
        showToast('Home Content saved');
    } catch(e) {
        showToast('Error saving: ' + e.message, true);
    }
});

// ============================================================
// SKILLS CRUD
// ============================================================
const skillCategory = document.getElementById('skill-category');
const skillItems = document.getElementById('skill-items');
const skillOrder = document.getElementById('skill-order');
const skillEditId = document.getElementById('skill-edit-id');
const skillFormTitle = document.getElementById('skill-form-title');
const skillSaveBtn = document.getElementById('skill-save-btn');
const skillCancelBtn = document.getElementById('skill-cancel-btn');
const skillListEl = document.getElementById('skill-list');

async function loadSkills() {
    const q = query(collection(db, 'skills'), orderBy('order', 'asc'));
    const snap = await getDocs(q);
    skillListEl.innerHTML = '';
    if (snap.empty) {
        skillListEl.innerHTML = '<p class="empty-state">No skills categories yet.</p>';
        return;
    }
    snap.forEach(docSnap => {
        const d = docSnap.data();
        const item = document.createElement('div');
        item.className = 'admin-item';
        item.innerHTML = `
            <div class="admin-item-info">
                <h4>${esc(d.category || 'Untitled')}</h4>
                <p>${esc(d.items || '')}</p>
            </div>
            <div class="admin-item-actions">
                <button class="pixel-btn secondary btn-sm" data-edit="${docSnap.id}">Edit</button>
                <button class="pixel-btn danger btn-sm" data-del="${docSnap.id}">Del</button>
            </div>
        `;
        item.querySelector('[data-edit]').addEventListener('click', () => {
            skillEditId.value = docSnap.id;
            skillCategory.value = d.category || '';
            skillItems.value = d.items || '';
            skillOrder.value = d.order ?? 0;
            skillFormTitle.textContent = '✎ Edit Skill Category';
            skillCancelBtn.style.display = 'inline-block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        item.querySelector('[data-del]').addEventListener('click', async () => {
            if (!confirm('Delete this skill category?')) return;
            await deleteDoc(doc(db, 'skills', docSnap.id));
            showToast('Skill Category deleted');
            loadSkills();
        });
        skillListEl.appendChild(item);
    });
}

skillSaveBtn.addEventListener('click', async () => {
    const data = {
        category: skillCategory.value.trim(),
        items: skillItems.value.trim(),
        order: parseInt(skillOrder.value) || 0
    };
    if (!data.category) { showToast('Category name required', true); return; }

    try {
        if (skillEditId.value) {
            await updateDoc(doc(db, 'skills', skillEditId.value), data);
            showToast('Skill Category updated');
        } else {
            await addDoc(collection(db, 'skills'), data);
            showToast('Skill Category added');
        }
        resetSkillForm();
        loadSkills();
    } catch (e) {
        showToast('Error: ' + e.message, true);
    }
});

skillCancelBtn.addEventListener('click', resetSkillForm);

function resetSkillForm() {
    skillEditId.value = '';
    skillCategory.value = '';
    skillItems.value = '';
    skillOrder.value = '0';
    skillFormTitle.textContent = '+ Add Skill Category';
    skillCancelBtn.style.display = 'none';
}
