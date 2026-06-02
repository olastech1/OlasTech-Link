/**
 * OlasTech Link — Frontend Controller (Production)
 * =================================================
 * Calls the real backend API for payments and code validation.
 * Uses Paystack Inline JS for the payment popup.
 */

(function () {
  'use strict';

  // ── Plan Data (loaded from server) ────────────────────────────
  let PLANS = {};

  const sessionData     = document.getElementById('sessionData');

  function showSuccess(sessionInfo) {
    const successOverlay = document.getElementById('successOverlay');
    const displayPlanName = document.getElementById('displayPlanName');
    const displayDuration = document.getElementById('displayDuration');
    const displayData = document.getElementById('displayData');
    
    displayPlanName.textContent = sessionInfo.plan;

    // Calculate Remaining Time
    if (sessionInfo.sessionExpires) {
      const expires = new Date(sessionInfo.sessionExpires);
      const diffMs = expires - new Date();
      if (diffMs > 0) {
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        let timeText = '';
        if (diffDays > 0) timeText += diffDays + ' Days ';
        timeText += diffHours + ' Hours';
        displayDuration.textContent = timeText;
      } else {
        displayDuration.textContent = 'Expired';
      }
    } else {
      displayDuration.textContent = sessionInfo.duration_h + ' Hours';
    }

    // Display Remaining Data
    if (sessionInfo.remaining_mb !== null && sessionInfo.remaining_mb !== undefined) {
      displayData.textContent = (sessionInfo.remaining_mb / 1024).toFixed(2) + ' GB';
    } else if (sessionInfo.data_mb) {
      displayData.textContent = (sessionInfo.data_mb / 1024).toFixed(2) + ' GB';
    } else {
      displayData.textContent = 'Unlimited';
    }

    successOverlay.classList.add('visible');
    
    setTimeout(() => {
      window.location.reload();
    }, 5000);
  }

  // ── Info Modals (About, Terms, Contact) ──────────────────────
  const infoModal = document.getElementById('infoModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');

  const modalContent = {
    about: {
      title: 'About OlasTech Link',
      body: `
        <p>Welcome to <strong>OlasTech Link</strong>, your premium high-speed internet provider.</p>
        <p>We leverage advanced enterprise-grade Omada Controller systems to provide seamless, encrypted, and ultra-fast Wi-Fi connections.</p>
        <p>Our multi-device nodes allow you to share a single access code across your laptops, phones, and smart TVs instantly.</p>
      `
    },
    terms: {
      title: 'Terms of Service',
      body: `
        <h4>1. Acceptable Use</h4>
        <p>By connecting to this network, you agree not to use the service for any illegal or malicious activities. We reserve the right to monitor bandwidth usage for network stability.</p>
        <h4>2. Data Usage & Limits</h4>
        <p>If you exhaust your purchased data quota, your devices will be automatically disconnected. Shared codes count data usage across all connected devices collectively.</p>
        <h4>3. Refunds</h4>
        <p>All token purchases are final. If you experience downtime or issues, please contact our support.</p>
      `
    },
    contact: {
      title: 'Contact Us',
      body: `
        <p>Need help with your connection or a token?</p>
        <p><strong>Phone / WhatsApp:</strong> +234 816 274 7882</p>
        <p><strong>Email:</strong> support@olastech.ng</p>
        <p><strong>Operating Hours:</strong> 24/7 Monitoring & Support</p>
      `
    }
  };

  function openModal(type) {
    if (!modalContent[type]) return;
    modalTitle.textContent = modalContent[type].title;
    modalBody.innerHTML = modalContent[type].body;
    infoModal.classList.add('visible');
  }

  document.getElementById('linkAbout')?.addEventListener('click', (e) => { e.preventDefault(); openModal('about'); });
  document.getElementById('linkTerms')?.addEventListener('click', (e) => { e.preventDefault(); openModal('terms'); });
  document.getElementById('linkContact')?.addEventListener('click', (e) => { e.preventDefault(); openModal('contact'); });
  
  modalClose?.addEventListener('click', () => { infoModal.classList.remove('visible'); });
  infoModal?.addEventListener('click', (e) => {
    if (e.target === infoModal) infoModal.classList.remove('visible');
  });

  // ── State ─────────────────────────────────────────────────────
  let selectedPlan = null;
  let paystackPublicKey = null;

  // ── TP-Link Omada URL Parameters ──────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const portalConfig = {
    clientMac:   params.get('clientMac')   || params.get('client_mac')   || '',
    apMac:       params.get('apMac')       || params.get('ap_mac')       || '',
    ssidName:    params.get('ssidName')    || params.get('ssid')         || 'OlasTech_WiFi',
  };

  // ── Initialize ────────────────────────────────────────────────
  async function init() {
    if (portalConfig.ssidName) ssidDisplay.textContent = portalConfig.ssidName;

    // Fetch dynamic plans
    try {
      const res = await fetch('/api/plans');
      const data = await res.json();
      if (data.success && data.plans) {
        data.plans.forEach(p => PLANS[p.id] = p);
        renderPlans(data.plans);
      } else {
        if(plansGrid) plansGrid.innerHTML = '<div style="color:var(--red);text-align:center;width:100%;padding:20px">Failed to load plans.</div>';
      }
    } catch (e) {
      if(plansGrid) plansGrid.innerHTML = '<div style="color:var(--red);text-align:center;width:100%;padding:20px">Failed to connect to server.</div>';
    }
  }

  function renderPlans(plansList) {
    if (!plansGrid) return;
    plansGrid.innerHTML = '';
    
    plansList.forEach(plan => {
      const isBest = plan.is_best_value;
      const isPop = plan.is_popular;
      
      let topHtml = `<span class="plan-name">${plan.name}</span>`;
      if (isBest) {
        topHtml += `<span class="plan-badge best-value">Best Value</span>`;
      } else if (isPop) {
        topHtml += `<span class="plan-badge popular">Popular</span>`;
      }

      const dataText = plan.data_mb ? `${Math.floor(plan.data_mb / 1024)} GB` : 'Unlimited Data';
      const timeText = plan.data_mb ? '' : `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${plan.duration_h} Hr</span>`;

      const card = document.createElement('div');
      card.className = 'plan-card';
      card.setAttribute('data-plan', plan.id);
      card.setAttribute('tabindex', '0');
      card.innerHTML = `
        <div class="plan-top">
          ${topHtml}
        </div>
        <div class="plan-details">
          <span class="plan-price"><span class="currency">₦</span>${parseInt(plan.price).toLocaleString()}</span>
          <div class="plan-meta">
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> ${plan.devices} Device${plan.devices > 1 ? 's' : ''}</span>
            ${timeText}
            ${plan.data_mb ? `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/></svg> ${dataText}</span>` : ''}
          </div>
        </div>
      `;
      plansGrid.appendChild(card);
    });

    // Bind events for the newly created cards
    const newCards = plansGrid.querySelectorAll('.plan-card');
    newCards.forEach(card => {
      card.addEventListener('click', handlePlanClick);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handlePlanClick(e);
        }
      });
    });
  }

  // ── Plan Selection ────────────────────────────────────────────
  function handlePlanClick(e) {
    const card = e.target.closest('.plan-card');
    if (!card) return;
    plansGrid.querySelectorAll('.plan-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedPlan = card.dataset.plan;
    const plan = PLANS[selectedPlan];
    if (btnBuy) {
      btnBuy.disabled = false;
      btnBuy.textContent = `Pay ₦${plan.price.toLocaleString()} for Access`;
    }
    
    // Enable and configure WhatsApp button
    const whatsappBtn = document.getElementById('whatsappBuyBtn');
    if (whatsappBtn) {
      whatsappBtn.style.opacity = '1';
      whatsappBtn.style.pointerEvents = 'auto';
      whatsappBtn.style.cursor = 'pointer';
      
      const message = `Hello OlasTech, I want to purchase the ${plan.name} Plan for ₦${plan.price.toLocaleString()}.\n\nMy MAC Address: ${portalConfig.clientMac}`;
      whatsappBtn.href = `https://wa.me/2348162747882?text=${encodeURIComponent(message)}`;
    }
  }

  // ── UI Helpers ────────────────────────────────────────────────
  function showError(msg) {
    errorText.textContent = msg;
    errorMessage.classList.add('visible');
    errorMessage.style.animation = 'none';
    void errorMessage.offsetHeight;
    errorMessage.style.animation = '';
  }
  function hideError()   { errorMessage.classList.remove('visible'); }
  function showSuccess(msg) { successText.textContent = msg; successMessage.classList.add('visible'); }
  function hideSuccess() { successMessage.classList.remove('visible'); }

  function setLoading(btn, loading, label) {
    if (loading) {
      btn.classList.add('loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading');
      if (label) btn.textContent = label;
    }
  }

  // ── Boot ──────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
