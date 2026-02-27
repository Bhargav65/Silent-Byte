/**
 * ICE Server configuration.
 * 
 * Serves STUN/TURN credentials via a REST endpoint so the client
 * can fetch them dynamically instead of hardcoding in HTML.
 * 
 * To use your own TURN server, update the credentials via environment
 * variables: TURN_URL, TURN_USERNAME, TURN_CREDENTIAL
 */

function getIceServers() {
    const turnUrl = process.env.TURN_URL || 'openrelay.metered.ca';
    const turnUsername = process.env.TURN_USERNAME || 'openrelayproject';
    const turnCredential = process.env.TURN_CREDENTIAL || 'openrelayproject';

    return {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: `turn:${turnUrl}:80`,
                username: turnUsername,
                credential: turnCredential,
            },
            {
                urls: `turn:${turnUrl}:443`,
                username: turnUsername,
                credential: turnCredential,
            },
            {
                urls: `turn:${turnUrl}:443?transport=tcp`,
                username: turnUsername,
                credential: turnCredential,
            },
        ],
        iceCandidatePoolSize: 10,
    };
}

/**
 * Register the ICE config REST endpoint on an Express app.
 */
function registerIceEndpoint(app) {
    app.get('/api/ice-config', (req, res) => {
        res.json(getIceServers());
    });
}

module.exports = { getIceServers, registerIceEndpoint };
