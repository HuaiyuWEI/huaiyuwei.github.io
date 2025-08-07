---
permalink: /
title: "Huaiyu Wei"
author_profile: true
redirect_from:
  - /about/
  - /about.html
---

I am currently a Postdoctoral Researcher at the UCLA Department of Atmospheric and Oceanic Sciences, working with [Andrew Stewart](https://dept.atmos.ucla.edu/stewart/home). I am interested in a wide range of topics in geophysical fluid dynamics, including mesoscale eddies, topography-flow interaction, and overturning circulations. Before joining UCLA, I completed my Ph.D. at the Hong Kong University of Science and Technology under the guidance of [Yan Wang](https://yanwanghkust.github.io/).

---

## Research Projects

### 🌀 Mesoscale Eddy Parameterization over Sloping Topography

<p style="display: flex; gap: 20px; flex-wrap: wrap;">
  <video width="360" controls>
    <source src="/videos/Prograde.mp4" type="video/mp4">
    Your browser does not support the video tag.
  </video>
  <video width="360" controls>
    <source src="/videos/retrograde.mp4" type="video/mp4">
    Your browser does not support the video tag.
  </video>
</p>

*My doctoral research focused on parameterizing mesoscale eddy flux over sloping seafloors across both prograde (left video) and retrograde fronts (right video). We developed slope-aware parameterization schemes for both eddy advection and eddy diffusion, and some of these parameterizations have been implemented into MITgcm.*

<br />
<div style="text-align: center;">
  <img
    src="images/ww21.png"
    alt="Schematic of eddy diffusion across continental slopes under upwelling-favorable winds"
    width="680"
  />
</div>
*We found that, apart from the mean‐flow suppression effect, eddy anisotropy induced by steep topography shapes both the horizontal and vertical structures of cross‐shore eddy diffusion. Heuristically speaking, steep topography “squeezes” eddies, making them highly anisotropic and inefficient at stirring tracers cross‐shore ([Wei & Wang 2021](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2021MS002498)).*

<br />
![Slope‐aware GEOMETRIC scaling for eddy buoyancy flux](images/WWSM22.png)  
*Existing eddy parameterizations cannot constrain eddy advection across continental slopes. We proposed a slope‐aware GEOMETRIC scaling that incorporates topographic suppression effects via analytical functions of the slope Burger number ([Wei et al. 2022](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2022MS003229); [Wei et al. 2024](https://doi.org/10.1175/JPO-D-23-0152.1)).*

---

### 🎰 Reconstructing the Meridional Overturning Circulation Using Machine Learning

![Dual‐branch neural network architecture for MOC reconstruction](images/DBNN.png)

*We developed a dual‐branch neural network that uses satellite‐measurable quantities (such as ocean bottom pressure, sea surface height, and wind stress) to reconstruct the  meridional overturning circulation (MOC) in both the Atlantic Ocean and the Southern Ocean ([Wei et al. 2025](https://doi.org/10.1029/2024MS004915)).*

<br />
<video width="700" controls>
  <source src="/videos/Truth_Vs_Reconstruction.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

*Animation comparing diagnosed vs. reconstructed MOC on decadal and longer timescales in the ACCESS-ESM1.5 preindustrial simulation.*

---

### ♆ Formation of Abyssal Prograde Flows via Eddy Potential Vorticity Mixing

![Idealized simulation of abyssal prograde flows](images/Neptune_model.png)

*Observations and simulations have revealed widespread prograde mean flows (currents aligned with the direction of topographic Rossby wave propagation along isobaths) over sloping topography in the abyssal ocean. Using idealized simulations, we show that prograde flows (red shading in the bottom left panel) are driven by eddy momentum fluxes (black arrows) resulting from mesoscale eddy stirring of potential vorticity (PV) gradients induced by the sloping seafloor. We found that eddy PV stirring becomes much less efficient over steeper slopes, resulting in reduced PV mixing and weaker prograde flows, despite larger background PV gradients induced by the steep seafloor.*

---

### ♆ Influence of Abyssal Prograde Flows on Slope‐Adjacent Upwelling

![Schematic of slope-adjacent upwelling in the abyssal overturning circulation](images/Neptune_Upwelling.png)

*The modern view of the abyssal overturning circulation return pathway suggests that dense water rises primarily through diapycnal upwelling within thin bottom boundary layers along sloping ocean boundaries. We are investigating how mesoscale eddies and prograde flows influence this slope‐adjacent upwelling paradigm.*

---

## 📫 Contact

Feel free to reach out for discussion or collaboration!  
📧 [huaiyu.wei@atmos.ucla.edu](mailto:hywei@atmos.ucla.edu)  
