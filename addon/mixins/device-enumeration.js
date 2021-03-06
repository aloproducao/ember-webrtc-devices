/* global webrtcsupport, _ */

import Ember from 'ember';

const { Mixin, RSVP, computed, run } = Ember;

export default Mixin.create({
  // options
  fullHd: false,

  canListDevices: false,

  // camera and video stuff
  hasCameraPermission: false,
  cameraList: [],
  hasCamera: computed('cameraList', function () {
    return !!_.find(this.get('cameraList'), (camera) => camera.deviceId !== 'default');
  }),
  canShareVideo: computed('canListDevices', 'hasCameraPermission', 'hasCamera', 'hasMicPermission', function () {
    // if old version we just assume they can since there's no way to really know
    if (!this.get('canListDevices')) {
      return true;
    }

    // not much we can do here. we can really only guess they haven't given video permissions if they have a camera and have already given mic permissions
    if (!this.get('hasCameraPermission')) {
      return !(this.get('hasMicPermission') && this.get('hasCamera'));
    }
    return true;
  }),

  // mic and audio stuff
  hasMicPermission: false,
  microphoneList: [],
  hasMicrophone: computed('microphoneList', function () {
    return !!_.find(this.get('microphoneList'), (mic) => mic.deviceId !== 'default');
  }),
  canShareAudio: computed('canListDevices', 'hasCameraPermission', 'hasMicrophone', 'hasMicPermission', function () {
    // if old version we just assume they can since there's no way to really know
    if (!this.get('canListDevices')) {
      return true;
    }

    // not much we can do here. we can really only guess they haven't given audio permissions if they have a mic and have already given camera permissions
    if (!this.get('hasMicPermission')) {
      return !(this.get('hasCameraPermission') && this.get('hasMicrophone'));
    }
    return true;
  }),

  noVideoHardware: computed('canShareAudio', 'canShareVideo', function () {
    return !this.get('canShareAudio') && !this.get('canShareVideo');
  }),

  callCapable: computed('noVideoHardware', function () {
    if (!webrtcsupport.support || !webrtcsupport.supportWebAudio) {
      return false;
    }

    return !this.get('noVideoHardware');
  }),

  outputDeviceList: Ember.A(),
  resolutionList: Ember.A(),

  canShareScreen: false,

  // Returns a promise which resolves when all devices have been enumerated and loaded
  init () {
    this._super(...arguments);
    run.next(this, function () {
      this.enumerateDevices();
      this.enumerateResolutions();
    });
    this.set('canShareScreen', webrtcsupport.supportScreenSharing);

    this.lookup = this.lookup || ((key) => key);
  },

  updateDefaultDevices (/* devices */) {
    throw new Error('updateDefaultDevices should be overridden - do you need to save preferences or change video stream?');
  },

  enumerateResolutions () {
    const resolutions = this.get('resolutionList');
    resolutions.pushObject(Ember.Object.create({
      label: this.lookup('webrtcDevices.resolutions.low').toString(),
      presetId: 1,
      constraints: {
        video: {
          width: { max: 320 },
          height: { max: 240 }
        }
      }
    }));

    resolutions.pushObject(Ember.Object.create({
      label: this.lookup('webrtcDevices.resolutions.medium').toString(),
      presetId: 2,
      constraints: {
        video: {
          width: { max: 640 },
          height: { max: 480 }
        }
      }
    }));

    const hd = Ember.Object.create({
      label: this.lookup('webrtcDevices.resolutions.high').toString(),
      presetId: 3,
      constraints: {
        video: {
          width: {
            min: 640,
            ideal: 1280,
            max: 1920
          },
          height: {
            min: 480,
            ideal: 720,
            max: 1080
          }
        }
      }
    });
    resolutions.pushObject(hd);

    // full hd is disabled by default because very few computers actually support this
    if (this.get('fullHd')) {
      resolutions.pushObject(Ember.Object.create({
        label: this.lookup('webrtcDevices.resolutions.fullHd').toString(),
        presetId: 4,
        constraints: {
          video: {
            width: { exact: 1920 },
            height: { exact: 1080 }
          }
        }
      }));
    }
    return resolutions;
  },

  enumerateDevices () {
    if (!window.navigator.mediaDevices || !window.navigator.mediaDevices.enumerateDevices) {
      return;
    }
    let cameraCount = 0;
    let microphoneCount = 0;
    let outputDeviceCount = 0;
    const cameras = [];
    const microphones = [];
    const outputDevices = [];
    const defaultDevice = {
      deviceId: 'default',
      label: this.lookup('webrtcDevices.default').toString()
    };

    const addCamera = (device, hasLabel) => {
      if (!hasLabel) {
        device.label = this.lookup('webrtcDevices.cameraLabel', {number: ++cameraCount}).toString();
      }
      this.set('hasCameraPermission', this.get('hasCameraPermission') || hasLabel);
      cameras.push(Ember.Object.create(device));
    };
    const addMicrophone = (device, hasLabel) => {
      if (!hasLabel) {
        device.label = this.lookup('webrtcDevices.microphoneLabel', {number: ++microphoneCount}).toString();
      }
      this.set('hasMicPermission', this.get('hasMicPermission') || hasLabel);
      microphones.push(Ember.Object.create(device));
    };
    const addOutputDevice = (device, hasLabel) => {
      if (!window.HTMLMediaElement.prototype.hasOwnProperty('setSinkId')) {
        return;
      }
      if (!hasLabel) {
        device.label = this.lookup('webrtcDevices.outputDeviceLabel', {number: ++outputDeviceCount}).toString();
      }
      outputDevices.push(Ember.Object.create(device));
    };

    // always add a dummy default for video, since the browser doesn't give us one like microphone
    if (webrtcsupport.support) {
      addCamera(defaultDevice, true);
    }
    return window.navigator.mediaDevices.enumerateDevices().then((devices) => {
      if (webrtcsupport.prefix === 'moz' && webrtcsupport.browserVersion < 42) {
        this.set('canListDevices', false);
        addMicrophone(defaultDevice);
      } else {
        this.set('canListDevices', true);
        this.setProperties({
          hasCameraPermission: false,
          hasMicPermission: false
        });

        devices.forEach((device) => {
          const deviceInfo = {
            deviceId: device.deviceId,
            label: device.label
          };
          const hasLabel = !_.isEmpty(device.label);

          if (device.kind === 'audioinput') {
            addMicrophone(deviceInfo, hasLabel);
          } else if (device.kind === 'audiooutput') {
            addOutputDevice(deviceInfo, hasLabel);
          } else if (device.kind === 'videoinput') {
            addCamera(deviceInfo, hasLabel);
          }
        });
      }

      this.setProperties({
        cameraList: Ember.A(cameras),
        microphoneList: Ember.A(microphones),
        outputDeviceList: Ember.A(outputDevices)
      });
    }).catch(function () {
      this.set('canListDevices', false);
      addMicrophone(defaultDevice);
    });
  },

  setOutputDevice (el, device) {
    if (!(device && device.deviceId)) {
      return RSVP.Promise.reject('Cannot set null device');
    }

    if (typeof el.setSinkId !== 'undefined') {
      return new RSVP.Promise(function (resolve) {
        if (el.paused) {
          el.onplay = () => resolve();
        } else {
          resolve();
        }
      }).then(function () {
        el.setSinkId(device.deviceId);
      }).then(() => {
        Ember.Logger.log('successfully set audio output device');
      }).catch((err) => {
        Ember.Logger.error('failed to set audio output device', err);
      });
    } else {
      Ember.Logger.error('attempted to set sink id in unsupported browser');
      return RSVP.Promise.reject('Not supported');
    }
  },

  setDefaultOutputDevice (el) {
    return this.setOutputDevice(el, this.get('defaultOutputDevice'));
  }
});
