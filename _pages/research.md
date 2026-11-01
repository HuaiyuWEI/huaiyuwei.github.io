---
layout: archive
title: "Research"
permalink: /research/
author_profile: true
description: "Huaiyu Wei studies how mesoscale eddies interact with seafloor topography and uses deep learning to monitor the overturning circulation from satellites."
sidebar:
  - text: |
      <nav class="research-toc" aria-label="On this page">
        <p class="research-toc__title">On this page</p>
        <a href="#moc-reconstruction"><span>01</span>MOC reconstruction</a>
        <a href="#eddy-parameterization"><span>02</span>Eddy parameterization</a>
        <a href="#abyssal-prograde-flows"><span>03</span>Abyssal prograde flows</a>
        <a href="#bottom-boundary-upwelling"><span>04</span>Eddy-mediated upwelling</a>
      </nav>
---

<!-- Layout classes are styled in _sass/_research.scss; the "On this page" list in the front matter appears in the sidebar on desktop.
Overview cards: research-overview--text on the nav below shows text-only cards with one-line summaries. Remove that class to show the card images instead:
images/thumb_*.jpg, 3:2 landscape, 1200x800 px recommended (600x400 at least), always shown whole. Linking a figure to itself opens it full size in a lightbox.
Every block of a section, figures included, ends at the text measure (two thirds of the column), so text and figures share both edges. -->

<p class="research-intro">My research asks: <em>How do mesoscale eddies interact with seafloor topography, and how does this interaction modulate the ocean’s overturning circulation?</em> I approach it with theory, simulations, and machine learning.</p>

<nav class="research-overview research-overview--text" aria-label="Research projects">
  <a href="#moc-reconstruction">
    <img src="/images/thumb_DBNN.jpg" alt="" width="600" height="400" loading="lazy">
    <span class="research-overview__body">
      <span class="research-overview__num">01</span>
      <span class="research-overview__title">MOC reconstruction</span>
      <span class="research-overview__summary">We use deep learning to reconstruct the MOC from satellite observations.</span>
    </span>
  </a>
  <a href="#eddy-parameterization">
    <img src="/images/thumb_ww21.jpg" alt="" width="600" height="400" loading="lazy">
    <span class="research-overview__body">
      <span class="research-overview__num">02</span>
      <span class="research-overview__title">Eddy parameterization</span>
      <span class="research-overview__summary">We propose topography-aware physics-based and machine-learning-augmented schemes.</span>
    </span>
  </a>
  <a href="#abyssal-prograde-flows">
    <img src="/images/thumb_Neptune_PV.jpg" alt="" width="600" height="400" loading="lazy">
    <span class="research-overview__body">
      <span class="research-overview__num">03</span>
      <span class="research-overview__title">Abyssal prograde flows</span>
      <span class="research-overview__summary">Driven by eddy potential vorticity mixing and strongest over intermediate slopes.</span>
    </span>
  </a>
  <a href="#bottom-boundary-upwelling">
    <img src="/images/thumb_Neptune_Upwelling.jpg" alt="" width="600" height="400" loading="lazy">
    <span class="research-overview__body">
      <span class="research-overview__num">04</span>
      <span class="research-overview__title">Eddy-mediated upwelling</span>
      <span class="research-overview__summary">How eddies and prograde flows shape diapycnal upwelling along slopes.</span>
    </span>
  </a>
</nav>

<section class="research-project" id="moc-reconstruction">
  <header class="research-project__header">
    <h2><span class="research-project__num">01</span> Reconstructing the meridional overturning circulation using machine learning</h2>
    <p class="research-project__lede">Observing arrays measure the meridional overturning circulation (MOC) at only a few Atlantic latitudes. We developed NeurMOC, a deep-learning reconstruction of MOC changes since 2003 from satellite observations.</p>
  </header>
  <p>We find evidence of Atlantic MOC declines and, in the Southern Ocean, a strengthening mid-depth cell and a weakening abyssal cell (<a href="https://doi.org/10.22541/essoar.15004679/v1">Wei et al. 2026, preprint</a>).</p>
  <p class="research-cta"><a href="/neurmoc/">Explore the interactive <strong>NeurMOC</strong> viewer</a></p>
  <figure class="research-figure">
    <a href="/images/DBNN.png"><img src="/images/DBNN.png" alt="Dual-branch neural network architecture for MOC reconstruction" width="1834" height="1911" loading="lazy"></a>
    <figcaption>Dual-branch neural network mapping bottom pressure, sea surface height, and zonal wind to MOC changes.</figcaption>
  </figure>
  <div class="research-papers">
    <h3>Key papers</h3>
    <ul>
      <li><b>Wei, H.</b>, Stewart, A. L., Medvedev, A., Srinivasan, K., Solodoch, A., Manucharyan, G., &amp; Hogg, A. (2026). <a href="https://doi.org/10.22541/essoar.15004679/v1">Deep learning unlocks satellite-based monitoring of the global ocean overturning circulation</a>. Preprint, ESS Open Archive.</li>
      <li>Medvedev, A., <b>Wei, H.</b>, Armour, K. C., Srinivasan, K., Solodoch, A., Stewart, A. L., &amp; Manucharyan, G. (2026). <a href="https://doi.org/10.22541/essoar.15002298/v1">Basin-wide sea-surface observations reveal post-2000 emergence of AMOC weakening</a>. Preprint, ESS Open Archive.</li>
      <li><b>Wei, H.</b>, Srinivasan, K., Stewart, A. L., Solodoch, A., Manucharyan, G., &amp; Hogg, A. (2025). <a href="https://doi.org/10.1029/2024MS004915">Full-depth reconstruction of long-term meridional overturning circulation variability from satellite-measurable quantities via machine learning</a>. Journal of Advances in Modeling Earth Systems.</li>
    </ul>
  </div>
</section>

<section class="research-project" id="eddy-parameterization">
  <header class="research-project__header">
    <h2><span class="research-project__num">02</span> Mesoscale eddy parameterization over sloping topography</h2>
    <p class="research-project__lede">Mesoscale eddies over continental shelves and slopes mediate exchanges between coastal seas and the open ocean, but widely used parameterizations, developed primarily for the open ocean, do not adequately represent shelf/slope eddy transports. We developed eddy parameterizations that work in both settings.</p>
  </header>
  <figure class="research-figure">
    <a href="/images/ww21.png"><img src="/images/ww21.png" alt="Schematic of eddy diffusion across continental slopes under upwelling-favorable winds" width="2550" height="1815" loading="lazy"></a>
    <figcaption>Along-isopycnal eddy diffusivity under upwelling-favorable winds: suppressed in the jet, minimized where the steep slope makes eddies anisotropic, enhanced offshore.</figcaption>
  </figure>
  <div class="research-papers">
    <h3>Key papers</h3>
    <ul>
      <li><b>Wei, H.</b>, Wang, Y., &amp; Mak, J. (2024). <a href="https://doi.org/10.1175/JPO-D-23-0152.1">Parameterizing eddy buoyancy fluxes across prograde shelf/slope fronts using a slope-aware GEOMETRIC closure</a>. Journal of Physical Oceanography.</li>
      <li>Xie, C.*, <b>Wei, H.</b>*, &amp; Wang, Y. (2023a). <a href="https://doi.org/10.1175/JPO-D-23-0017.1">Bathymetry-aware mesoscale eddy parameterizations across upwelling slope fronts: A machine learning-augmented approach</a>. Journal of Physical Oceanography. (*Contributed equally)</li>
      <li>Xie, C., <b>Wei, H.</b>, &amp; Wang, Y. (2023b). <a href="https://doi.org/10.1029/2022MS003424">Impact of parameterized isopycnal diffusivity on shelf-ocean exchanges under upwelling-favorable winds: offline tracer simulations augmented by artificial neural network</a>. Journal of Advances in Modeling Earth Systems.</li>
      <li><b>Wei, H.</b>, Wang, Y., Stewart, A. L., &amp; Mak, J. (2022). <a href="https://doi.org/10.1029/2022MS003229">Scalings for eddy buoyancy fluxes across prograde shelf/slope fronts</a>. Journal of Advances in Modeling Earth Systems. (Issue cover)</li>
      <li><b>Wei, H.</b>, &amp; Wang, Y. (2021). <a href="https://doi.org/10.1029/2021MS002498">Full-depth scalings for isopycnal eddy mixing across continental slopes under upwelling-favorable winds</a>. Journal of Advances in Modeling Earth Systems. (Issue cover)</li>
    </ul>
  </div>
</section>

<section class="research-project" id="abyssal-prograde-flows">
  <header class="research-project__header">
    <h2><span class="research-project__num">03</span> Formation of abyssal prograde flows via eddy potential vorticity mixing</h2>
    <p class="research-project__lede">Abyssal currents over sloping seafloors tend to flow prograde, with shallower water to the right in the Northern Hemisphere. We show how eddy potential vorticity mixing drives them. We derive a scaling for the strength of eddy-driven abyssal prograde flow.</p>
  </header>
  <figure class="research-figure">
    <a href="/images/Neptune_Pacific.jpg"><img src="/images/Neptune_Pacific.jpg" alt="Prograde bottom flow in a 6-km Pacific simulation: surface vorticity above the seafloor, the time-mean prograde velocity in the bottom boundary layer, and its distribution" width="2000" height="1534" loading="lazy"></a>
    <figcaption>Prevalence of abyssal prograde flow in an eddy-resolving Pacific simulation.</figcaption>
  </figure>
  <div class="research-papers">
    <h3>Key paper</h3>
    <ul>
      <li><b>Wei, H.</b>, Stewart, A. L., McWilliams, J. C., &amp; Capó, E. (2026). <a href="https://doi.org/10.1175/JPO-D-25-0196.1">Formation of abyssal downwelling-favorable prograde flows via mesoscale eddy potential vorticity mixing</a>. Journal of Physical Oceanography.</li>
    </ul>
  </div>
</section>

<section class="research-project" id="bottom-boundary-upwelling">
  <header class="research-project__header">
    <h2><span class="research-project__num">04</span> Mesoscale eddy-mediated diapycnal upwelling in the ocean’s sloping bottom boundary</h2>
    <p class="research-project__lede">Dense abyssal waters are thought to upwell diapycnally along sloping boundaries, yet eddy-driven prograde currents there induce near-bottom <em>downslope</em> Ekman transport. We are investigating how these currents interact with mixing-driven upwelling.</p>
  </header>
  <figure class="research-figure">
    <a href="/images/Neptune_Paradigms.png"><img src="/images/Neptune_Paradigms.png" alt="Schematic. (a) Mixing-dominated paradigm: at the insulating seafloor, water parcels can only gain buoyancy from above, so they upwell along the boundary; further aloft, diapycnal downwelling occurs due to bottom-intensified mixing. (b) Eddy-mediated paradigm: eddies shape diapycnal upwelling by driving prograde flows and downhill advection, inducing eddy buoyancy fluxes, and modulating near-bottom stratification." width="3495" height="986" loading="lazy"></a>
    <figcaption>Two paradigms of near-bottom diapycnal upwelling: mixing‑dominated (a, adapted from <a href="https://doi.org/10.1175/JPO-D-15-0244.1">Ferrari et al. 2016</a>) and eddy-mediated (b, based on our diagnostics).</figcaption>
  </figure>
</section>

<script>
  (function () {
    var links = document.querySelectorAll('.research-toc a');
    var sections = document.querySelectorAll('.research-project');
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.research-toc a, .research-overview a')) { e.stopPropagation(); }
    }, true);
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      window.addEventListener('load', function () { document.documentElement.style.scrollBehavior = 'smooth'; });
    }
    if (!links.length || !sections.length || !('IntersectionObserver' in window)) { return; }
    var byId = {};
    Array.prototype.forEach.call(links, function (a) { byId[a.hash.slice(1)] = a; });
    function mark(active) {
      Array.prototype.forEach.call(links, function (a) { a.classList.remove('is-active'); a.removeAttribute('aria-current'); });
      if (active) { active.classList.add('is-active'); active.setAttribute('aria-current', 'true'); }
    }
    var observer = new IntersectionObserver(function (entries) {
      var root = entries[0] && entries[0].rootBounds, line = root ? root.bottom : window.innerHeight * 0.4, active = null;
      Array.prototype.forEach.call(sections, function (s) {
        if (s.getBoundingClientRect().top <= line) { active = byId[s.id]; }
      });
      mark(active);
    }, { rootMargin: '0px 0px -60% 0px' });
    Array.prototype.forEach.call(sections, function (s) { observer.observe(s); });
  })();
</script>
