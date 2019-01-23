/**
 * @classdesc
 * Model class for external devices
 */

'use strict'

const C = require('../constants/constants');
const SdpWrapper = require('../utils/sdp-wrapper');
const rid = require('readable-id');
const Media = require('./media');
const Balancer = require('../media/balancer');
const config = require('config');
const Logger = require('../utils/logger');

module.exports = class SDPMedia extends Media {
  constructor(
    room,
    user,
    mediaSessionId,
    offer,
    answer,
    type,
    adapter,
    adapterElementId,
    host,
    options
  ) {
    super(room, user, mediaSessionId, type, adapter, adapterElementId, host, options);
    Logger.info("[mcs-sdp-media] New session with options", type);
    // {SdpWrapper} SdpWrapper
    this.offer;
    this.answer;

    if (offer) {
      this.setOffer(offer);
    }

    if (answer) {
      this.setAnswer(answer);
    }

    this._updateHostLoad();
  }

  setOffer (offer) {
    if (offer) {
      if (this.offer) {
        this._shouldRenegotiate = true;
      }

      this.offer = new SdpWrapper(offer, this.mediaSpecs, this.mediaProfile);
    }
  }

  setAnswer (answer) {
    if (answer) {
      // Manual NAT traversal for when the media server is behind NAT
      if (this.type !== C.MEDIA_TYPE.WEBRTC) {
        answer = SdpWrapper.nonPureReplaceServerIpv4(answer, this.host.ip);
      }

      this.answer = new SdpWrapper(answer, this.mediaSpecs, this.mediaProfile);
      this.mediaTypes.video = this.answer.hasAvailableVideoCodec();
      this.mediaTypes.audio = this.answer.hasAvailableAudioCodec();
    }
  }

  _candidateExistsInSDP (candidate) {
    if (this.offer && this.offer._plainSdp) {
      const candidateFoundationRegex = /candidate:([\d]*)/ig;
      const sdpCandidatesFoundationRegex = /a=candidate:([\d]*)/ig;
      const candidateFoundation = candidateFoundationRegex.exec(candidate);
      const sdpCandidates = this.offer._plainSdp.match(sdpCandidatesFoundationRegex);
      if (candidateFoundation && candidateFoundation[1] && sdpCandidates && sdpCandidates.find(s => s.includes(candidateFoundation[1]))) {
        return true;
      }

      return false;
    }
  }

  addIceCandidate (candidate) {
    return new Promise(async (resolve, reject) => {
      try {

        if (this._candidateExistsInSDP(candidate.candidate)) {
          // just ignore this candidate as it was passed on the SDP already
          return resolve();
        }

        await this.adapter.addIceCandidate(this.adapterElementId, candidate);
        resolve();
      }
      catch (err) {
        return reject(this._handleError(err));
      }
    });
  }

  _updateHostLoad () {
    if (this.answer.hasAvailableVideoCodec()) {
      Balancer.incrementHostStreams(this.host.id, 'video');
      this.hasVideo = true;
    }

    if (this.answer.hasAvailableAudioCodec()) {
      Balancer.incrementHostStreams(this.host.id, 'audio');
      this.hasAudio = true;
    }
  }
}
