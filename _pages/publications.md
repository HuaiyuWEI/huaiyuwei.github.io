---
layout: archive
title: "Publications"
permalink: /publications/
author_profile: true
---

{% if site.author.googlescholar %}
  <div class="wordwrap">You can also find my publications on <a href="{{site.author.googlescholar}}">my Google Scholar profile</a>.</div>
{% endif %}

## Preprints


- **Wei, H.**, Stewart, A. L., Medvedev, A.,  Srinivasan, K., Solodoch, A., Manucharyan, G., Hogg, A. Deep learning unlocks satellite-based monitoring of the global ocean overturning circulation. _ESS Open Archive_. [(DOI)](https://doi.org/10.22541/essoar.15004679/v1)

- Medvedev, A., **Wei, H.**, Armour, K. C., Srinivasan, K., Solodoch, A., Stewart, A. L., Manucharyan, G. Basin-wide sea-surface observations reveal post-2000 emergence of AMOC weakening. _ESS Open Archive_. [(DOI)](https://doi.org/10.22541/essoar.15002298/v1)

## Peer-Reviewed Publications

{% assign publications = site.data.publications %}
{% for pub in publications %}
{{ forloop.index }}. {{ pub.entry }}
{% endfor %}

## Dissertation
**Wei, H.** (2024). Parameterizing Mesoscale Eddy Fluxes Across Continental Slopes. _Ph.D. dissertation, The Hong Kong University of Science and Technology_. [(Available online)](https://lbezone.hkust.edu.hk/rse/?p=63844)
