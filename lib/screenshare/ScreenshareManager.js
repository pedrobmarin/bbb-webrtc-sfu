/*
 * Lucas Fialho Zawacki
 * Paulo Renato Lanzarin
 * (C) Copyright 2017 Bigbluebutton
 *
 */

"use strict";

const BigBlueButtonGW = require('../bbb/pubsub/bbb-gw');
const Screenshare = require('./screenshare');
const BaseManager = require('../base/BaseManager');
const C = require('../bbb/messages/Constants');
const Logger = require('../utils/Logger');

module.exports = class ScreenshareManager extends BaseManager {
  constructor (connectionChannel, additionalChannels, logPrefix) {
    super(connectionChannel, additionalChannels, logPrefix);
    this.messageFactory(this._onMessage);
    this._iceQueues = {};
  }

  async _onMessage(message) {
    Logger.debug(this._logPrefix, 'Received message [' + message.id + '] from connection', message.connectionId);

    const sessionId = message.voiceBridge;
    const connectionId = message.connectionId;
    const role = message.role;
    const sdpOffer = message.sdpOffer
      const callerName = message.callerName? message.callerName : 'default';
    const meetingId = message.internalMeetingId;
    const streamId = message.streamId? message.streamId : meetingId;
    let iceQueue, session;

    session = this._fetchSession(sessionId);
    iceQueue = this._fetchIceQueue(sessionId);

    switch (message.id) {
      case 'start':
        if (!session) {
          session = new Screenshare(
              connectionId,
              this._bbbGW,
              sessionId,
              connectionId,
              message.vh,
              message.vw,
              message.internalMeetingId,
              streamId
              );
          this._sessions[sessionId] = session;
        }

        // starts presenter by sending sessionID, websocket and sdpoffer
        session.start(sessionId, connectionId, sdpOffer, callerName, role, (error, sdpAnswer) => {
          Logger.info(this._logPrefix, "Started presenter ", sessionId, " for connection", connectionId);
          if (error) {
            this._bbbGW.publish(JSON.stringify({
              connectionId: connectionId,
              type: C.SCREENSHARE_APP,
              role: role,
              id : 'startResponse',
              response : 'rejected',
              message : error
            }), C.FROM_SCREENSHARE);
            return error;
          }

          this._bbbGW.once(C.PRESENTER_ASSIGNED_MESSAGE+meetingId, async (payload) => {
            await this.closeSession(session, connectionId, role, sessionId);
            this._bbbGW.publish(JSON.stringify({
              connectionId: connectionId,
              type: C.SCREENSHARE_APP,
              id : 'close',
            }), C.FROM_SCREENSHARE);
          });

          this._bbbGW.once(C.TRANSCODER_ERROR+meetingId, async (payload) => {
            this._bbbGW.publish(JSON.stringify({
              connectionId: connectionId,
              id: "webRTCScreenshareError",
              error: C.MEDIA_ERROR
            }), C.FROM_SCREENSHARE);
          });


          // Empty ice queue after starting session
          if (iceQueue) {
            let candidate;
            while(candidate = iceQueue.pop()) {
              session.onIceCandidate(candidate, role, callerName);
            }
          }

          this._bbbGW.publish(JSON.stringify({
            connectionId: connectionId,
            type: C.SCREENSHARE_APP,
            role: role,
            id : 'startResponse',
            response : 'accepted',
            sdpAnswer : sdpAnswer
          }), C.FROM_SCREENSHARE);

          session.once(C.MEDIA_SERVER_OFFLINE, (event) => {
            this._stopSession(sessionId);
          });

          Logger.info(this._logPrefix, "Sending presenterResponse to presenter", sessionId, "for connection", session._id);
        });
        break;

      case 'stop':
        Logger.info(this._logPrefix, 'Received stop message for session', sessionId, "at connection", connectionId);

        if (session) {
          session._stop(sessionId);
        } else {
          Logger.warn(this._logPrefix, "There was no screensharing session on stop for", sessionId);
        }
        break;

      case 'onIceCandidate':
        if (session && session.constructor === Screenshare) {
          session.onIceCandidate(message.candidate, role, callerName);
        } else {
          Logger.info(this._logPrefix, "Queueing ice candidate for later in screenshare", message.voiceBridge);
          iceQueue.push(message.candidate);
        }
        break;

      case 'subscribe':
        Logger.info("Received SUBSCRIBE from external source", message);
        if (session == null) {
          return;
        }

        const retRtp = await session.mcs.subscribe(session.userId,
            session.sharedScreens[sessionId],
            'RtpEndpoint',
            {
              descriptor: sdpOffer,
              keyframeInterval:2
            });

        this._bbbGW.publish(JSON.stringify({
          id: 'subscribe',
          type: C.SCREENSHARE_APP,
          role: 'recv',
          response: 'accepted',
          meetingId: meetingId,
          voiceBridge: sessionId,
          sessionId: retRtp.sessionId,
          answer: retRtp.answer
        }), C.FROM_SCREENSHARE);
        break;

      case 'close':
        this.closeSession(session, connectionId, role, sessionId);
        break;

      default:
        this._bbbGW.publish(JSON.stringify({
          connectionId: session._id? session._id : 'none',
          id : 'error',
          message: 'Invalid message ' + message
        }), C.FROM_SCREENSHARE);
    }
  }

  async closeSession (session, connectionId, role, sessionId) {
    Logger.info(this._logPrefix, 'Connection ' + connectionId + ' closed');

    if (session && session.constructor == Screenshare) {
      if (role === C.SEND_ROLE && session) {
        Logger.info(this._logPrefix, "Stopping presenter " + sessionId);
        await this._stopSession(sessionId);
        return;
      }
      else if (role === C.RECV_ROLE && session) {
        Logger.info(this._logPrefix, "Stopping viewer " + sessionId);
        await session.stopViewer(connectionId);
        return;
      }
    }
  }
};
