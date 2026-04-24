---
layout: archive
title: "Publications"
permalink: /publications/
author_profile: true
---

{% if site.author.googlescholar %}
  <div class="wordwrap">You can also find my publications on <a href="{{site.author.googlescholar}}">my Google Scholar profile</a>.</div>
{% endif %}

## 📝 In Preparation / Submitted


- <ins>***Wei, H.***</ins>, Stewart, A. L., et al. Satellite monitoring of global ocean over-
turning circulation enabled by deep learning. _In preparation_. (Preprint available upon request)

- Medvedev, A., <ins>***Wei, H.***</ins>, Armour, K. C., et al. Basin-wide sea-surface observations reveal post-2000 emergence of AMOC weakening. _ESS Open Archive_. [(DOI)](https://doi.org/10.22541/essoar.15002298/v1)

---
## 📚 Peer-Reviewed Publications

{% assign publications = site.data.publications %}
{% for pub in publications %}
{{ forloop.index }}. {{ pub.entry }}
{% endfor %}

---
## 🎓 Dissertation
<ins>***Wei, H.***</ins> (2024). Parameterizing Mesoscale Eddy Fluxes Across Continental Slopes. _Ph.D. dissertation, The Hong Kong University of Science and Technology_. [(Available online)](https://lbezone.hkust.edu.hk/rse/?p=63844)
