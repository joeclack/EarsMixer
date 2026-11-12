"use strict";
// The HTTP server: static files, API routes and network discovery.
const express = require("express");
const http = require('http');
const path = require('node:path');
const logger = require('../logging/logger.js');
const { useTemplateRoutes } = require('../templates.js');
const { advertiseMixer } = require('../discovery.js');
const { musicianCors } = require('../musician-cors.js');
const { state, appVersion } = require('./state.js');
const mixView = require('./mix.js');
const clients = require('./clients.js');
const { useMusicianRoutes } = require('./routes/musician.js');
const { useAdminRoutes } = require('./routes/admin.js');
const { useSettingsRoutes } = require('./routes/settings.js');
const { usePresetRoutes } = require('./routes/presets.js');
const webDirectory = path.join(__dirname, '..', '..', 'web');
const discoveryStops = new Set();

/**
 * Start the main web server
 */
function startServer()
{
	// Create an Express-based Web Socket server that clients can connect to
	let app = express();
	app.use(musicianCors);
	app.use(express.urlencoded({ extended: true }));
	app.use(express.json());
	state.adminAuth.register(app);
	useTemplateRoutes(app);
	useMusicianRoutes(app);
	useAdminRoutes(app);

	// Apply no-cache policy for admin endpoints to prevent stale browser state
	app.use(["/admin", "/admin.html", "/admin.js", "/admin.css"], (req, res, next) => {
		res.set("Cache-Control", "no-store");
		next();
	});

	// Tell express to use all the static files in /web
	app.use("/", express.static(webDirectory));

	// Create the web server
	state.server = http.createServer(app);
	state.server.on("error", function(err)
	{
		if(err.code == "EADDRINUSE" || err.code == "EACCES")
		{
			logger.error(`Web server port ${state.config.server.port} is ${err.code == "EACCES" ? "not permitted (ports below 1024 need elevated privileges)" : "already in use"}. ` +
				`Close whatever is using it or change the Webserver Port in the admin area.`);
			process.exit(1);
		}
		logger.error("Web server error: " + (err && err.stack ? err.stack : err));
	});
	const webServer = state.server;
	const bindAddress = process.env.OSC_WEBMIXER_BIND_ADDRESS || "0.0.0.0";
	webServer.once('listening', () => {
		if (process.env.OSC_WEBMIXER_DISCOVERY === '0') return;
		const stop = advertiseMixer({ port: webServer.address().port, version: appVersion, bindAddress, logger });
		discoveryStops.add(stop);
		webServer.once('close', () => { discoveryStops.delete(stop); void stop(); });
	});
	webServer.listen(state.config.server.port, bindAddress);

	// Session middleware above protects both dashboard and native settings routes.
	useSettingsRoutes(app);
	usePresetRoutes(app);

	logger.info(`Web Server Ready. Please visit ${mixView.getServerURL()}/admin in a web browser to configure EarsMixer.`);
	clients.startWebSocketServer();
}

Object.assign(exports, { startServer, discoveryStops });
