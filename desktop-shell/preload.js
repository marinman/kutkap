// Lets the editor style its header as the macOS title bar (see .kutkap-titlebar in globals.css).
window.addEventListener("DOMContentLoaded", () => {
	document.documentElement.dataset.shell = "desktop";
});
