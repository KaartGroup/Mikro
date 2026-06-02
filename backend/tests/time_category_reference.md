# Time Entry Categorization Reference

This table shows how each activity type and subcategory combination gets grouped in reports.
Use it to verify that hours are landing in the right report bucket.

---

<table>
  <thead>
    <tr>
      <th>Activity logged</th>
      <th>Subcategory entered</th>
      <th>Appears in report as</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="3">QC Review</td>
      <td>Community QC</td>
      <td><strong>Community QC</strong></td>
    </tr>
    <tr>
      <td>Kaart QC</td>
      <td><strong>QC</strong></td>
    </tr>
    <tr>
      <td><em>blank / anything else</em></td>
      <td><strong>QC</strong></td>
    </tr>
    <tr>
      <td rowspan="2">Validating <em>(legacy)</em></td>
      <td>Community Project</td>
      <td><strong>Community QC</strong></td>
    </tr>
    <tr>
      <td><em>blank / anything else</em></td>
      <td><strong>QC</strong></td>
    </tr>
    <tr>
      <td>Editing</td>
      <td><em>any</em></td>
      <td><strong>Editing</strong></td>
    </tr>
    <tr>
      <td rowspan="3">Documentation</td>
      <td>Wiki Documentation</td>
      <td><strong>Community Documentation</strong></td>
    </tr>
    <tr>
      <td>Project Workflow Documentation</td>
      <td><strong>Documentation</strong></td>
    </tr>
    <tr>
      <td><em>blank / anything else</em></td>
      <td><strong>Documentation</strong></td>
    </tr>
    <tr>
      <td>Imagery Capture</td>
      <td><em>any (e.g. "Narrow Road Imagery Collection")</em></td>
      <td><strong>Imagery Capture</strong></td>
    </tr>
    <tr>
      <td>Project Creation</td>
      <td><em>any (including "Community Project")</em></td>
      <td><strong>Project Creation</strong></td>
    </tr>
    <tr>
      <td rowspan="3">Training</td>
      <td>Community</td>
      <td><strong>Community Training</strong></td>
    </tr>
    <tr>
      <td>Internal / Kaart</td>
      <td><strong>Training</strong></td>
    </tr>
    <tr>
      <td><em>blank / anything else</em></td>
      <td><strong>Training</strong></td>
    </tr>
    <tr>
      <td rowspan="3">Meeting</td>
      <td>Community</td>
      <td><strong>Community Meeting</strong></td>
    </tr>
    <tr>
      <td>Internal Team Members</td>
      <td><strong>Meeting</strong></td>
    </tr>
    <tr>
      <td><em>blank / anything else</em></td>
      <td><strong>Meeting</strong></td>
    </tr>
    <tr>
      <td rowspan="3">Other</td>
      <td>Community Outreach</td>
      <td><strong>Community Outreach</strong></td>
    </tr>
    <tr>
      <td><em>any text containing "community" or "outreach"</em></td>
      <td><strong>Community Outreach</strong></td>
    </tr>
    <tr>
      <td><em>blank / anything else</em></td>
      <td><strong>Other</strong></td>
    </tr>
  </tbody>
</table>

---

## Fuzzy Matching Note

For entries logged as **Other**, the system checks whether the subcategory text contains the word **"community"** or **"outreach"** (case-insensitive, partial match). This means entries like:

- "Community outreach - IWD Event Indonesia" → **Community Outreach**
- "Communiry Event" _(typo)_ → **Community Outreach**
- "Community QC/Notes Review" → **Community Outreach**
- "community project/challenge updates" → **Community Outreach**

If the subcategory does not contain those words, it falls into **Other**.

---

## Legacy Activities

The activity type **Validating** is an older label still present in historical records. It follows the same rules as **QC Review** — subcategory "Community Project" maps to Community QC, everything else maps to QC.
