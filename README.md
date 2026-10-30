# Faysal Mahmud — Portfolio

Personal portfolio of Faysal Mahmud, CSE student at AIUB. Static site with a 3D laptop built with Three.js, hosted on GitHub Pages.

Live: https://faysalmahmud313.github.io/Portfolio/

## Run locally

Open the folder in VS Code and start **Live Server** on `index.html`.

## Edit content

1. Create `admin.env` next to `index.html`:
   ```
   ADMIN_PASSWORD=your-password
   ```
2. Run the site locally, press `Ctrl + Shift + A`, and log in.
3. Edit, then **GitHub Sync & Export → Download Updated data.js**.
4. Replace `js/data.js` with the downloaded file and push.

To offer a CV download, put the PDF at `assets/cv/Faysal Mahmud - CV.pdf` and push. The download buttons appear automatically.

After changing any file in `js/` or `css/`, bump the `?v=` number on the script and stylesheet links in `index.html` so visitors get the new files right away.

The editor only works locally. `admin.env` is gitignored and never pushed.
