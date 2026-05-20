# BMconvert

BMconvert is a browser-based reader for Boardmaker files.

It focuses on:

- extracting readable metadata from the file header
- previewing embedded assets when the browser can decode them, plus EMF fallback rendering
- producing a clean print and PDF view in the browser

## Status

This is an MVP reader, not a full semantic Boardmaker editor.

## Local preview

Open index.html directly in a browser, or serve the folder with a static web server.

Example:

python3 -m http.server 4173

Then visit http://localhost:4173.

## GitHub Pages

The repository is set up to be published as a static site from GitHub Pages.
