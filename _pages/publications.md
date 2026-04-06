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
-<ins>***Wei, H.***</ins>, Stewart, A. L., McWilliams, J. C., Capó, E. Formation of abyssal downwelling-favorable prograde flows via mesoscale eddy potential vorticity mixing. _Journal of Physical Oceanography_. _In presse_.

-<ins>***Wei, H.***</ins>, Stewart, A. L., et al. Machine learning-enabled satellite monitoring of
ocean overturning circulation. _In preparation_. (Preprint available upon request)

---
## 📚 Peer-Reviewed Publications

{% assign publications = site.data.publications %}
{% for pub in publications %}
{{ forloop.index }}. {{ pub.entry }}
{% endfor %}

---
## 🎓 Dissertation
<ins>***Wei, H.***</ins> (2024). Parameterizing Mesoscale Eddy Fluxes Across Continental Slopes. _Ph.D. dissertation, The Hong Kong University of Science and Technology_. [(Available online)](https://lbezone.hkust.edu.hk/rse/?p=63844)
