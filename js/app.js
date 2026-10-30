let currentPortfolioData = null;
let currentProjectFilter = 'all';

// Storage may be blocked
const safeStorage = {
  get(key, session = false) {
    try { return (session ? sessionStorage : localStorage).getItem(key); } catch (e) { return null; }
  },
  set(key, value, session = false) {
    try { (session ? sessionStorage : localStorage).setItem(key, value); } catch (e) {  }
  },
  remove(key, session = false) {
    try { (session ? sessionStorage : localStorage).removeItem(key); } catch (e) {  }
  }
};
window.safeStorage = safeStorage;

document.addEventListener('DOMContentLoaded', () => {
  loadPortfolioData();

  renderAllSections();

  if (typeof Portfolio3DScene !== 'undefined' && typeof THREE !== 'undefined') {
    try {
      new Portfolio3DScene('webgl-hero-container');
    } catch (e) {
      console.warn('3D scene failed to start:', e);
      document.getElementById('webgl-hero-container')?.classList.add('no-webgl');
      document.documentElement.classList.add('no-webgl');
    }
  } else {
    document.getElementById('webgl-hero-container')?.classList.add('no-webgl');
    document.documentElement.classList.add('no-webgl');
  }

  setupNavbarScroll();
  setupMobileMenu();
  setupTerminal();
  setupFilterButtons();
  setup3DCardTilt();
  setupContactForm();
  setupScrollUI();
  setupModalBehaviour();

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  setupRevealAnimations();
});

// Visitors always get data.js
function hasOwnerDraft() {
  return safeStorage.get('cse_portfolio_draft') === '1';
}

function loadPortfolioData() {
  const saved = safeStorage.get('cse_portfolio_data');

  if (saved && hasOwnerDraft()) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.personal && parsed.projects) {
        if (parsed.admin) delete parsed.admin.passcode;
        currentPortfolioData = parsed;
        return;
      }
    } catch (e) {
      console.error('Error parsing stored data:', e);
    }
  }

  safeStorage.remove('cse_portfolio_data');
  safeStorage.remove('cse_portfolio_draft');
  safeStorage.remove('portfolio_data_version');
  currentPortfolioData = JSON.parse(JSON.stringify(window.DEFAULT_PORTFOLIO_DATA || {}));
  if (currentPortfolioData.admin) delete currentPortfolioData.admin.passcode;
}

function savePortfolioData(newData) {
  currentPortfolioData = newData;
  safeStorage.set('cse_portfolio_data', JSON.stringify(newData));
  safeStorage.set('cse_portfolio_draft', '1');
  renderAllSections();
  setup3DCardTilt();
  if (typeof lucide !== 'undefined') lucide.createIcons();
  setupRevealAnimations();
  window.portfolioScene?.refreshContent();
  showToast('Portfolio updated successfully! Changes saved locally.');
}

function renderAllSections() {
  renderHero();
  renderAbout();
  renderEducation();
  renderSkills();
  renderProjects();
  renderResearch();
  renderExperience();
  renderCertifications();
  renderFooter();
}

function renderHero() {
  const p = currentPortfolioData.personal;
  if (!p) return;

  const statusBadge = document.getElementById('hero-status-badge');
  if (statusBadge) {
    statusBadge.innerHTML = `<span class="pulse-dot"></span><span>${escapeHTML(p.statusBadge)}</span>`;
  }

  const nameEl = document.getElementById('hero-name');
  if (nameEl) nameEl.textContent = p.name;

  const roleEl = document.getElementById('hero-role');
  if (roleEl) roleEl.textContent = p.role;

  const taglineEl = document.getElementById('hero-tagline');
  if (taglineEl) taglineEl.textContent = p.tagline;

  const statsWrap = document.getElementById('hero-stats-ribbon');
  if (statsWrap && p.stats) {
    statsWrap.innerHTML = p.stats.map(s => `
      <div class="stat-item">
        <span class="stat-value">${escapeHTML(s.value)}</span>
        <span class="stat-label">${escapeHTML(s.label)}</span>
        <span class="stat-note">${escapeHTML(s.note || '')}</span>
      </div>
    `).join('');
  }

  const resumeBtn = document.getElementById('hero-resume-btn');
  if (resumeBtn) {
    if (p.resumeUrl && p.resumeUrl !== '#resume-preview' && p.resumeUrl !== '#') {
      resumeBtn.href = p.resumeUrl;
      resumeBtn.target = '_blank';
    } else {
      resumeBtn.href = '#resume-preview';
      resumeBtn.onclick = (e) => {
        e.preventDefault();
        openResumeModal();
      };
    }
  }
}

function renderAbout() {
  const p = currentPortfolioData.personal;
  if (!p) return;

  const avatarImg = document.getElementById('about-avatar-img');
  if (avatarImg) {
    avatarImg.src = p.avatar || 'assets/images/demo-avatar.svg';
    avatarImg.alt = p.name;
  }

  const aboutName = document.getElementById('about-name');
  if (aboutName) aboutName.textContent = p.name;

  const aboutDept = document.getElementById('about-dept');
  if (aboutDept) {
    aboutDept.textContent = `${p.department || 'Computer Science & Engineering'} • ${p.university || 'AIUB'}`;
  }

  const aboutBioP1 = document.getElementById('about-bio-p1');
  if (aboutBioP1) aboutBioP1.textContent = p.bioP1;

  const aboutBioP2 = document.getElementById('about-bio-p2');
  if (aboutBioP2) aboutBioP2.textContent = p.bioP2;

  const metaList = document.getElementById('about-meta-list');
  if (metaList) {
    metaList.innerHTML = `
      <div class="contact-meta-item">
        <i data-lucide="map-pin"></i>
        <span>${escapeHTML(p.location)}</span>
      </div>
      <div class="contact-meta-item">
        <i data-lucide="mail"></i>
        <a href="mailto:${encodeURIComponent(p.email)}" class="contact-value" style="font-size:0.85rem">${escapeHTML(p.email)}</a>
      </div>
      <div class="contact-meta-item">
        <i data-lucide="graduation-cap"></i>
        <span>AIUB (CSE Department)</span>
      </div>
      <div class="contact-meta-item">
        <i data-lucide="award"></i>
        <span>AIUB R&D Club Organizer</span>
      </div>
    `;
  }

  const interestsContainer = document.getElementById('career-interests-tags');
  if (interestsContainer && p.careerInterests) {
    interestsContainer.innerHTML = p.careerInterests.map(interest => `
      <span class="interest-tag">${escapeHTML(interest)}</span>
    `).join('');
  }
}

function renderEducation() {
  const eduList = currentPortfolioData.education || [];
  const container = document.getElementById('education-list');
  if (!container) return;

  container.innerHTML = eduList.map((edu) => `
    <div class="timeline-card tilt-card" data-tilt>
      <div class="timeline-header">
        <div>
          <div class="institution-title">
            <i data-lucide="graduation-cap" style="color:var(--accent-cyan)"></i>
            <span>${escapeHTML(edu.institution)}</span>
            <span class="project-badge-pill" style="position:static; margin-left:0.5rem">${escapeHTML(edu.badge || 'AIUB CSE')}</span>
          </div>
          <div class="degree-name">${escapeHTML(edu.degree)}</div>
        </div>
        <div class="education-meta">
          <span class="duration-pill">${escapeHTML(edu.duration)}</span>
          <span class="score-badge">${escapeHTML(edu.score)}</span>
        </div>
      </div>

      <p class="about-p" style="margin-bottom:0.75rem">${escapeHTML(edu.description || '')}</p>

      ${edu.achievements && edu.achievements.length > 0 ? `
        <ul class="exp-bullets" style="margin-bottom:1rem">
          ${edu.achievements.map(ach => `<li>${escapeHTML(ach)}</li>`).join('')}
        </ul>
      ` : ''}

      ${edu.coursework && edu.coursework.length > 0 ? `
        <div class="coursework-wrap">
          <div class="coursework-label">Key Relevant Coursework:</div>
          <div class="coursework-tags">
            ${edu.coursework.map(c => `<span class="coursework-tag">${escapeHTML(c)}</span>`).join('')}
          </div>
        </div>
      ` : ''}

      <button class="admin-edit-pill" onclick="openAdminModal('education', '${edu.id}')" style="margin-top:1rem">
        <i data-lucide="edit-3"></i> Edit Entry
      </button>
    </div>
  `).join('');
}

function renderSkills() {
  const skillsData = currentPortfolioData.skills || [];
  const container = document.getElementById('skills-matrix');
  if (!container) return;

  container.innerHTML = skillsData.map(cat => `
    <div class="skill-category-card tilt-card" data-tilt>
      <h3 class="skill-category-title">
        <i data-lucide="${cat.icon || 'code-2'}" style="color:var(--accent-cyan)"></i>
        <span>${escapeHTML(cat.category)}</span>
      </h3>
      <div class="skill-chips-wrap">
        ${(cat.items || []).map(skill => `
          <div class="skill-chip">
            <span class="skill-chip-name">${escapeHTML(skill.name)}</span>
            <span class="skill-chip-tag">${escapeHTML(skill.tag || '')}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderProjects() {
  const projects = currentPortfolioData.projects || [];
  const container = document.getElementById('projects-grid');
  if (!container) return;

  const filtered = currentProjectFilter === 'all'
    ? projects
    : projects.filter(p => p.category === currentProjectFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 4rem; color: var(--text-muted)">
        <p>No projects found in this category.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(proj => `
    <div class="project-card tilt-card" data-tilt data-id="${proj.id}">
      <div class="project-image-box">
        <img src="${escapeHTML(proj.image || 'assets/images/project-nexttrip.svg')}" alt="${escapeHTML(proj.title)}" loading="lazy">
        ${proj.status ? `
          <span class="project-status-pill status-${proj.statusClass || 'completed'}">
            ${escapeHTML(proj.status)}
          </span>
        ` : ''}
        <span class="project-badge-pill">${escapeHTML(proj.categoryLabel || proj.category)}</span>
      </div>

      <div class="project-body">
        <h3 class="project-title">${escapeHTML(proj.title)}</h3>
        <div class="project-subtitle">${escapeHTML(proj.subtitle || '')}</div>
        <p class="project-summary">${escapeHTML(proj.summary || '')}</p>

        ${proj.metrics ? `
          <div class="project-metric-callout">
            <i data-lucide="check-circle" style="width:14px;height:14px"></i>
            <span>${escapeHTML(proj.metrics)}</span>
          </div>
        ` : ''}

        <div class="project-tags">
          ${(proj.tags || []).map(t => `<span class="tag-pill">${escapeHTML(t)}</span>`).join('')}
        </div>

        <div class="project-footer-actions">
          <div class="project-links">
            ${proj.github && proj.github !== '#' ? `
              <a href="${escapeHTML(proj.github)}" target="_blank" rel="noopener" class="icon-link-btn">
                <i data-lucide="github"></i> Code
              </a>
            ` : ''}
            ${proj.demo && proj.demo !== '#' ? `
              <a href="${escapeHTML(proj.demo)}" target="_blank" rel="noopener" class="icon-link-btn">
                <i data-lucide="external-link"></i> Live Demo
              </a>
            ` : ''}
          </div>

          <button class="details-modal-btn" onclick="openProjectModal('${proj.id}')">
            <span>Project Details</span> <i data-lucide="chevron-right"></i>
          </button>
        </div>

        <button class="admin-edit-pill" onclick="openAdminModal('projects', '${proj.id}')" style="margin-top:0.8rem; align-self: flex-start">
          <i data-lucide="edit-3"></i> Edit Project
        </button>
      </div>
    </div>
  `).join('');
}

function renderResearch() {
  const researchData = currentPortfolioData.research;
  if (!researchData) return;

  const areasContainer = document.getElementById('research-areas-grid');
  if (areasContainer && researchData.areas) {
    areasContainer.innerHTML = researchData.areas.map(area => `
      <div class="research-area-card tilt-card" data-tilt>
        <div class="research-area-header">
          <div class="research-icon-box">
            <i data-lucide="${area.icon || 'activity'}"></i>
          </div>
          <div class="research-area-title">${escapeHTML(area.title)}</div>
        </div>
        <p class="research-area-desc">${escapeHTML(area.desc)}</p>
      </div>
    `).join('');
  }

  const pubsContainer = document.getElementById('publications-list');
  if (pubsContainer && researchData.publications) {
    pubsContainer.innerHTML = researchData.publications.map(pub => `
      <div class="publication-card tilt-card" data-tilt>
        <div class="pub-badge-pill">
          <i data-lucide="book-open" style="width:13px;height:13px"></i>
          <span>${escapeHTML(pub.status)}</span>
        </div>
        <h3 class="pub-title">${escapeHTML(pub.title)}</h3>
        <div class="pub-authors">${escapeHTML(pub.authors)}</div>
        <div class="pub-venue">${escapeHTML(pub.conference)} (${escapeHTML(pub.year)})</div>
        <div class="pub-focus">
          <strong>Research Focus:</strong> ${escapeHTML(pub.focus)}
        </div>
        <div style="font-size:0.78rem; color:var(--text-dim); margin-bottom:0.8rem">
          ℹ️ <em>${escapeHTML(pub.note || '')}</em>
        </div>
        <div class="pub-links">
          ${pub.link && pub.link !== '#' ? `
            <a href="${escapeHTML(pub.link)}" target="_blank" rel="noopener" class="icon-link-btn">
              <i data-lucide="external-link"></i> View Publication / DOI
            </a>
          ` : `
            <span style="font-size:0.78rem; font-family:var(--font-mono); color:var(--accent-cyan)">[Author will link paper &amp; DOI manually]</span>
          `}
        </div>
      </div>
    `).join('');
  }
}

function renderExperience() {
  const experiences = currentPortfolioData.experience || [];
  const container = document.getElementById('experience-list');
  if (!container) return;

  container.innerHTML = experiences.map(exp => `
    <div class="exp-card tilt-card" data-tilt>
      <div class="exp-header">
        <div>
          <h3 class="exp-role">${escapeHTML(exp.role)}</h3>
          <div class="exp-company">${escapeHTML(exp.company)} • ${escapeHTML(exp.location || '')}</div>
        </div>
        <span class="exp-duration">${escapeHTML(exp.duration)}</span>
      </div>
      <ul class="exp-bullets">
        ${(exp.description || []).map(b => `<li>${escapeHTML(b)}</li>`).join('')}
      </ul>
      <button class="admin-edit-pill" onclick="openAdminModal('experience', '${exp.id}')" style="margin-top:1rem">
        <i data-lucide="edit-3"></i> Edit Role
      </button>
    </div>
  `).join('');
}

function renderCertifications() {
  const certs = currentPortfolioData.certifications || [];
  const container = document.getElementById('certifications-grid');
  if (!container) return;

  container.innerHTML = certs.map(c => `
    <div class="cert-card">
      <div class="cert-title">${escapeHTML(c.title)}</div>
      <div class="cert-issuer">${escapeHTML(c.issuer)}</div>
      <div class="cert-meta">${escapeHTML(c.date)} • ${escapeHTML(c.id)}</div>
      ${c.link && c.link !== '#' ? `
        <a href="${escapeHTML(c.link)}" target="_blank" rel="noopener" class="icon-link-btn" style="margin-top:0.5rem; font-size:0.78rem">
          <i data-lucide="external-link"></i> View Certificate / Link
        </a>
      ` : ''}
    </div>
  `).join('');
}

function renderFooter() {
  const p = currentPortfolioData.personal;
  if (!p) return;

  const copyName = document.getElementById('footer-copy-name');
  if (copyName) copyName.textContent = p.name;

  const socialLinks = document.getElementById('footer-socials');
  if (socialLinks) {
    socialLinks.innerHTML = `
      <a href="mailto:${encodeURIComponent(p.email)}" class="social-link" title="Direct Email"><i data-lucide="mail"></i></a>
      ${p.github ? `<a href="${escapeHTML(p.github)}" target="_blank" rel="noopener" class="social-link" title="GitHub"><i data-lucide="github"></i></a>` : ''}
      ${p.linkedin ? `<a href="${escapeHTML(p.linkedin)}" target="_blank" rel="noopener" class="social-link" title="LinkedIn"><i data-lucide="linkedin"></i></a>` : ''}
    `;
  }
}

function openProjectModal(projectId) {
  const projects = currentPortfolioData.projects || [];
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;

  const modal = document.getElementById('project-modal');
  const body = document.getElementById('project-modal-body');
  const title = document.getElementById('project-modal-title');
  if (!modal || !body || !title) return;

  title.textContent = proj.title;

  body.innerHTML = `
    <div style="margin-bottom: 1.5rem">
      <img src="${escapeHTML(proj.image || 'assets/images/project-nexttrip.svg')}" alt="${escapeHTML(proj.title)}" style="width:100%; max-height:280px; object-fit:cover; border-radius:12px; border:1px solid var(--border-subtle)">
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.8rem; margin-bottom:1.2rem">
      <div style="font-family:var(--font-mono); color:var(--accent-cyan); font-weight:600">${escapeHTML(proj.subtitle || '')}</div>
      <div style="display:flex; gap:0.5rem">
        ${proj.status ? `<span class="project-status-pill status-${proj.statusClass || 'completed'}" style="position:static">${escapeHTML(proj.status)}</span>` : ''}
        <span class="project-badge-pill" style="position:static">${escapeHTML(proj.categoryLabel || proj.category)}</span>
      </div>
    </div>

    <div style="margin-bottom:1.5rem">
      <h4 style="color:#fff; margin-bottom:0.5rem; font-size:1.05rem">Overview & Architecture</h4>
      <p style="color:var(--text-muted); line-height:1.7; font-size:0.95rem">${escapeHTML(proj.description || proj.summary)}</p>
    </div>

    ${proj.highlights && proj.highlights.length > 0 ? `
      <div style="margin-bottom:1.5rem">
        <h4 style="color:#fff; margin-bottom:0.6rem; font-size:1.05rem">Key Highlights & Implementation</h4>
        <ul class="exp-bullets">
          ${proj.highlights.map(h => `<li>${escapeHTML(h)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${proj.metrics ? `
      <div class="project-metric-callout" style="margin-bottom:1.5rem">
        <i data-lucide="check-circle"></i>
        <span>${escapeHTML(proj.metrics)}</span>
      </div>
    ` : ''}

    <div style="margin-bottom:1.5rem">
      <h4 style="color:#fff; margin-bottom:0.6rem; font-size:0.9rem">Technologies & Core Focus</h4>
      <div class="project-tags">
        ${(proj.tags || []).map(t => `<span class="tag-pill">${escapeHTML(t)}</span>`).join('')}
      </div>
    </div>

    <div class="modal-actions" style="display:flex; gap:1rem; padding-top:1rem; border-top:1px solid var(--border-subtle)">
      ${proj.github && proj.github !== '#' ? `
        <a href="${escapeHTML(proj.github)}" target="_blank" rel="noopener" class="btn-primary" style="font-size:0.88rem; padding:0.6rem 1.2rem">
          <i data-lucide="github"></i> View GitHub Repository
        </a>
      ` : ''}
      ${proj.demo && proj.demo !== '#' ? `
        <a href="${escapeHTML(proj.demo)}" target="_blank" rel="noopener" class="btn-secondary" style="font-size:0.88rem; padding:0.6rem 1.2rem">
          <i data-lucide="external-link"></i> Live Deployment
        </a>
      ` : ''}
      <button class="btn-secondary" onclick="closeProjectModal()" style="font-size:0.88rem; padding:0.6rem 1.2rem">
        Close
      </button>
    </div>
  `;

  modal.classList.add('active');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeProjectModal() {
  const modal = document.getElementById('project-modal');
  if (modal) modal.classList.remove('active');
}

function openResumeModal() {
  const modal = document.getElementById('resume-modal');
  if (!modal) return;
  modal.classList.add('active');
}

function closeResumeModal() {
  const modal = document.getElementById('resume-modal');
  if (modal) modal.classList.remove('active');
}

function setup3DCardTilt() {
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const cards = document.querySelectorAll('.tilt-card:not([data-tilt-bound])');
  cards.forEach(card => {
    card.setAttribute('data-tilt-bound', '');
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -6;
      const rotateY = ((x - centerX) / centerX) * 6;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.015, 1.015, 1.015)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    });
  });
}

function setupTerminal() {
  const input = document.getElementById('terminal-input');
  const body = document.getElementById('terminal-body');
  if (!input || !body) return;

  const handleCommand = (cmdText) => {
    const cmd = cmdText.trim().toLowerCase();
    if (!cmd) return;

    const userLine = document.createElement('div');
    userLine.className = 'terminal-line';
    userLine.innerHTML = `<span class="terminal-prompt">recruiter@faysal-term:~$</span> <span class="terminal-cmd">${escapeHTML(cmd)}</span>`;
    body.appendChild(userLine);

    const outLine = document.createElement('div');
    outLine.className = 'terminal-line';
    outLine.style.color = 'var(--text-muted)';

    const p = currentPortfolioData.personal;

    switch (cmd) {
      case 'help':
        outLine.innerHTML = `
          Available commands:<br>
          &nbsp;&nbsp;<span style="color:var(--accent-cyan)">whoami</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- Professional introduction &amp; role<br>
          &nbsp;&nbsp;<span style="color:var(--accent-cyan)">education</span>&nbsp;&nbsp;- University &amp; academic department<br>
          &nbsp;&nbsp;<span style="color:var(--accent-cyan)">skills</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- Programming languages, tools &amp; frameworks<br>
          &nbsp;&nbsp;<span style="color:var(--accent-cyan)">projects</span>&nbsp;&nbsp;&nbsp;- Software engineering &amp; research projects<br>
          &nbsp;&nbsp;<span style="color:var(--accent-cyan)">research</span>&nbsp;&nbsp;&nbsp;- ML, Explainable AI &amp; cybersecurity domains<br>
          &nbsp;&nbsp;<span style="color:var(--accent-cyan)">leadership</span>&nbsp;- AIUB R&amp;D Club &amp; Scout volunteering<br>
          &nbsp;&nbsp;<span style="color:var(--accent-cyan)">contact</span>&nbsp;&nbsp;&nbsp;&nbsp;- Verified email &amp; location<br>
          &nbsp;&nbsp;<span style="color:var(--accent-cyan)">sudo hire</span>&nbsp;&nbsp;- Direct internship contact<br>
          &nbsp;&nbsp;<span style="color:var(--accent-cyan)">clear</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- Clear terminal window
        `;
        break;

      case 'whoami':
        outLine.innerHTML = `<strong>${escapeHTML(p.name)}</strong>: ${escapeHTML(p.role)}.<br>${escapeHTML(p.tagline)}`;
        break;

      case 'education':
        outLine.innerHTML = `• <strong>American International University-Bangladesh (AIUB)</strong><br>&nbsp;&nbsp;Department of Computer Science and Engineering (CSE)<br>&nbsp;&nbsp;Degree: Bachelor of Science in Computer Science and Engineering (B.Sc. in CSE)`;
        break;

      case 'skills':
        outLine.innerHTML = `
          • Languages &amp; Web: C++, Java, C#, HTML5, CSS3, JavaScript, PHP, SQL<br>
          • Tools &amp; Hardware: Git, GitHub, Arduino IDE, ESP32, LaTeX, Overleaf, SPSS, MySQL, MS SQL Server<br>
          • Technical Domains: Software Engineering, Web Development, Machine Learning, Explainable AI (SHAP), Embedded IoT, Cybersecurity
        `;
        break;

      case 'projects':
        outLine.innerHTML = `
          • <strong>NextTrip</strong>: Travel Management System (Software Engineering)<br>
          • <strong>FlowSense</strong>: AI Cash-Flow Co-Pilot &amp; Financial Rescue Platform (FinTechathon 2026)<br>
          • <strong>Bank Management System</strong>: Java-based banking application demonstrating OOP<br>
          • <strong>Tourism Management System</strong>: C# Windows Forms desktop application with SQL Server<br>
          • <strong>RA-BRI</strong>: Rheumatoid Arthritis Risk Prediction (NHANES, N=13,273, SHAP)<br>
          • <strong>EV Intrusion Detection</strong>: Cybersecurity &amp; ML in EV Charging Networks (CICEV2023)<br>
          • <strong>AI-Generated Faces</strong>: Survey research on digital human rights online (N=120 BD)<br>
          • <strong>AI DeskBuddy</strong>: ESP32-S3 smart desk companion with OLED expressions<br>
          • <strong>Faysal FileHub</strong>: ESP32-S3 &amp; W5500 Ethernet personal file server concept
        `;
        break;

      case 'research':
        outLine.innerHTML = `
          • ML-Based Health Risk Prediction (RA-BRI, NHANES Cohort)<br>
          • Explainable Artificial Intelligence (XAI) &amp; SHAP-Based Feature Interpretation<br>
          • EV Charging Station Cybersecurity &amp; Intrusion Detection (CICEV2023)<br>
          • AI Ethics &amp; Online Human Rights (Empirical Survey)<br>
          • Reported peer-reviewed publications: 2 Papers
        `;
        break;

      case 'leadership':
        outLine.innerHTML = `
          • <strong>AIUB R&amp;D Club</strong>: Event Organizer for seminars featuring Prof. Nowshad Amin, Prof. Pushp Lata (BITS Pilani), Dr. Saef Ullah Miah, Erasmus Mundus &amp; Research Workshops.<br>
          • <strong>Scout Volunteering</strong>: ~3 Years of community service, medical camp serving >1,300 people, relief drives, and served as Team Leader in two camps.
        `;
        break;

      case 'contact':
        outLine.innerHTML = `Email: <a href="mailto:${escapeHTML(p.email)}" style="color:var(--accent-cyan)">${escapeHTML(p.email)}</a><br>Location: ${escapeHTML(p.location)}`;
        break;

      case 'sudo hire':
        outLine.innerHTML = `<span style="color:var(--accent-emerald); font-weight:bold">DIRECT CONNECTION INITIATED!</span> Open for software engineering internships and research collaborations.<br>Contact email: <a href="mailto:${escapeHTML(p.email)}" style="color:var(--accent-cyan)">${escapeHTML(p.email)}</a>`;
        break;

      case 'clear':
        body.innerHTML = '';
        input.value = '';
        return;

      default:
        outLine.innerHTML = `<span style="color:#ef4444">Command not recognized: '${escapeHTML(cmd)}'. Type <span style="color:var(--accent-cyan)">help</span> to view available commands.</span>`;
    }

    body.appendChild(outLine);
    body.scrollTop = body.scrollHeight;
    input.value = '';
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleCommand(input.value);
    }
  });

  window.runTerminalCommand = (cmd) => {
    handleCommand(cmd);
  };
}

function setupFilterButtons() {
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentProjectFilter = btn.getAttribute('data-filter') || 'all';
      renderProjects();
      setup3DCardTilt();
      if (typeof lucide !== 'undefined') lucide.createIcons();
      setupRevealAnimations();
    });
  });
}

function setupNavbarScroll() {
  const header = document.getElementById('site-header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header?.classList.add('scrolled');
    } else {
      header?.classList.remove('scrolled');
    }
  }, { passive: true });
}

function setupMobileMenu() {
  const toggle = document.getElementById('mobile-toggle');
  const links = document.getElementById('nav-links');
  const backdrop = document.getElementById('nav-backdrop');
  if (!toggle || !links) return;

  const setOpen = (open) => {
    links.classList.toggle('open', open);
    backdrop?.classList.toggle('open', open);
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.innerHTML = `<i data-lucide="${open ? 'x' : 'menu'}"></i>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  toggle.addEventListener('click', () => setOpen(!links.classList.contains('open')));
  backdrop?.addEventListener('click', () => setOpen(false));

  links.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && links.classList.contains('open')) setOpen(false);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && links.classList.contains('open')) setOpen(false);
  });
}

function setupScrollUI() {
  const progress = document.getElementById('scroll-progress');
  const backToTop = document.getElementById('back-to-top');
  let ticking = false;

  const update = () => {
    ticking = false;
    const scrollY = window.scrollY || 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.transform = `scaleX(${max > 0 ? Math.min(scrollY / max, 1) : 0})`;
    backToTop?.classList.toggle('visible', scrollY > window.innerHeight * 0.9);
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();

  backToTop?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  if (!('IntersectionObserver' in window)) return;
  const navLinks = Array.from(document.querySelectorAll('.nav-link[href^="#"]'));
  const sections = navLinks
    .map(link => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = '#' + entry.target.id;
      navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });

  sections.forEach(section => observer.observe(section));
}

let revealObserver = null;
function setupRevealAnimations() {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !('IntersectionObserver' in window)) return;

  document.documentElement.classList.add('reveal-ready');

  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  }

  const selector = [
    '.section-header', '.about-card', '.terminal-window', '.timeline-card',
    '.skill-category-card', '.project-card', '.research-area-card', '.publication-card',
    '.exp-card', '.cert-card', '.contact-info-card', '.contact-form'
  ].join(',');

  document.querySelectorAll(selector).forEach(el => {
    if (el.classList.contains('reveal')) return;
    const siblings = Array.from(el.parentElement ? el.parentElement.children : []);
    const index = Math.max(0, siblings.indexOf(el));
    el.style.setProperty('--reveal-delay', `${(index % 4) * 70}ms`);
    el.classList.add('reveal');
    revealObserver.observe(el);
  });
}

function setupModalBehaviour() {
  const overlays = document.querySelectorAll('.modal-overlay');
  const syncBodyLock = () => {
    document.body.classList.toggle('modal-open', !!document.querySelector('.modal-overlay.active'));
  };

  overlays.forEach(overlay => {
    new MutationObserver(syncBodyLock).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && overlay.id !== 'admin-cms-modal') overlay.classList.remove('active');
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelectorAll('.modal-overlay.active');
    const top = open[open.length - 1];
    if (top) top.classList.remove('active');
  });
}

function setupContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('form-name')?.value || 'Recruiter';
    const email = document.getElementById('form-email')?.value || '';
    const subject = document.getElementById('form-subject')?.value || 'Internship / Project Inquiry';
    const message = document.getElementById('form-message')?.value || '';

    const p = currentPortfolioData.personal;
    const recipient = p.email || '23-54032-3@student.aiub.edu';
    const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject + ' - from ' + name)}&body=${encodeURIComponent(message + '\n\nSender Email: ' + email)}`;

    window.location.href = mailtoUrl;
    showToast('Opening your email client to send message to ' + p.name + '!');
    form.reset();
  });
}

function showToast(message) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i data-lucide="check-circle" style="color:var(--accent-emerald)"></i> <span>${escapeHTML(message)}</span>`;
  container.appendChild(toast);

  if (typeof lucide !== 'undefined') lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.showToast = showToast;
window.savePortfolioData = savePortfolioData;
window.openProjectModal = openProjectModal;
window.closeProjectModal = closeProjectModal;
window.openResumeModal = openResumeModal;
window.closeResumeModal = closeResumeModal;
