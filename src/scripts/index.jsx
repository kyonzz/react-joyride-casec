import React from 'react';
import PropTypes from 'prop-types';
import scroll from 'scroll';
import { getRootEl, getOffsetBoundingClientRect, logger, sanitizeSelector, getDocHeight } from './utils';

import Beacon from './Beacon';
import Tooltip from './Tooltip';

const defaultState = {
  action: '',
  index: 0,
  isRunning: false,
  isTourSkipped: false,
  shouldRedraw: true,
  shouldRenderTooltip: false,
  shouldRun: false,
  standaloneData: false, // The standalone tooltip data
  xPos: -1000,
  yPos: -1000
};

const callbackTypes = {
  STEP_BEFORE: 'step:before',
  BEACON_BEFORE: 'beacon:before',
  BEACON_TRIGGER: 'beacon:trigger',
  TOOLTIP_BEFORE: 'tooltip:before',
  STEP_AFTER: 'step:after',
  STANDALONE_BEFORE: 'standalone:before',
  STANDALONE_AFTER: 'standalone:after',
  OVERLAY: 'overlay:click',
  HOLE: 'hole:click',
  FINISHED: 'finished',
  TARGET_NOT_FOUND: 'error:target_not_found'
};

const DEFAULTS = {
  position: 'top',
  minWidth: 290
};

let hasTouch = false;

class Joyride extends React.Component {
  constructor(props) {
    super(props);

    this.state = { ...defaultState };

    this.listeners = {
      tooltips: {}
    };
  }

  static propTypes = {
    allowClicksThruHole: PropTypes.bool,
    autoStart: PropTypes.bool,
    callback: PropTypes.func,
    debug: PropTypes.bool,
    disableOverlay: PropTypes.bool,
    holePadding: PropTypes.number,
    keyboardNavigation: PropTypes.bool,
    locale: PropTypes.object,
    offsetParentSelector: PropTypes.string,
    resizeDebounce: PropTypes.bool,
    resizeDebounceDelay: PropTypes.number,
    run: PropTypes.bool,
    scrollOffset: PropTypes.number,
    scrollToFirstStep: PropTypes.bool,
    scrollToSteps: PropTypes.bool,
    showBackButton: PropTypes.bool,
    showOverlay: PropTypes.bool,
    showSkipButton: PropTypes.bool,
    showStepsProgress: PropTypes.bool,
    stepIndex: PropTypes.number,
    steps: PropTypes.array,
    type: PropTypes.string
  };

  static defaultProps = {
    allowClicksThruHole: false,
    autoStart: false,
    debug: false,
    disableOverlay: false,
    holePadding: 0,
    keyboardNavigation: true,
    locale: {
      back: 'Back',
      close: 'Close',
      last: 'Last',
      next: 'Next',
      skip: 'Skip'
    },
    offsetParentSelector: 'body',
    resizeDebounce: false,
    resizeDebounceDelay: 200,
    run: false,
    scrollOffset: 20,
    scrollToFirstStep: false,
    scrollToSteps: true,
    showBackButton: true,
    showOverlay: true,
    showSkipButton: false,
    showStepsProgress: false,
    stepIndex: 0,
    steps: [],
    type: 'single'
  };

  componentDidMount() {
    const {
      autoStart,
      keyboardNavigation,
      resizeDebounce,
      resizeDebounceDelay,
      run,
      steps,
      type
    } = this.props;

    logger({
      type: 'joyride:initialized',
      msg: [this.props],
      debug: this.props.debug,
    });

    const stepsAreValid = this.checkStepsValidity(steps);
    if (steps && stepsAreValid && run) {
      this.start(autoStart);
    }

    if (resizeDebounce) {
      let timeoutId;

      this.listeners.resize = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          timeoutId = null;
          this.calcPlacement();
        }, resizeDebounceDelay);
      };
    }
    else {
      this.listeners.resize = () => {
        this.calcPlacement();
      };
    }
    window.addEventListener('resize', this.listeners.resize);

    /* istanbul ignore else */
    if (keyboardNavigation && type === 'continuous') {
      this.listeners.keyboard = this.handleKeyboardNavigation;
      document.body.addEventListener('keydown', this.listeners.keyboard);
    }

    window.addEventListener('touchstart', function setHasTouch() {
      hasTouch = true;
      // Remove event listener once fired, otherwise it'll kill scrolling
      // performance
      window.removeEventListener('touchstart', setHasTouch);
    }, false);
  }

  componentWillReceiveProps(nextProps) {
    logger({
      type: 'joyride:willReceiveProps',
      msg: [nextProps],
      debug: nextProps.debug,
    });

    const { isRunning, shouldRun, standaloneData } = this.state;
    const { keyboardNavigation, run, steps, stepIndex } = this.props;
    const stepsChanged = (nextProps.steps !== steps);
    const stepIndexChanged = (nextProps.stepIndex !== stepIndex && nextProps.stepIndex !== this.state.index);
    const runChanged = (nextProps.run !== run);
    let shouldStart = false;
    let didStop = false;

    if (stepsChanged && this.checkStepsValidity(nextProps.steps)) {
      // Removed all steps, so reset
      if (!nextProps.steps || !nextProps.steps.length) {
        this.reset();
      }
      // Start the joyride if steps were added for the first time, and run prop is true
      else if (!steps.length && nextProps.run) {
        shouldStart = true;
      }
    }

    /* istanbul ignore else */
    if (runChanged) {
      // run prop was changed to off, so stop the joyride
      if (run && !nextProps.run) {
        this.stop();
        didStop = true;
      }
      // run prop was changed to on, so start the joyride
      else if (!run && nextProps.run) {
        shouldStart = true;
      }
      // Was not playing, but should, and isn't a standaloneData
      else if (!isRunning && (shouldRun && !standaloneData)) {
        shouldStart = true;
      }
    }

    /* istanbul ignore else */
    if (stepIndexChanged) {
      const hasStep = nextProps.steps[nextProps.stepIndex];
      const shouldDisplay = hasStep && nextProps.autoStart;
      if (runChanged && shouldStart) {
        this.start(nextProps.autoStart, nextProps.steps, nextProps.stepIndex);
      }
      // Next prop is set to run, and the index has changed, but for some reason joyride is not running
      // (maybe this is because of a target not mounted, and the app wants to skip to another step)
      else if (nextProps.run && !isRunning) {
        this.start(nextProps.autoStart, nextProps.steps, nextProps.stepIndex);
      }
      else if (!didStop) {
        this.toggleTooltip({ show: shouldDisplay, index: nextProps.stepIndex, steps: nextProps.steps, action: 'jump' });
      }
    }
    // Did not change the index, but need to start up the joyride
    else if (shouldStart) {
      this.start(nextProps.autoStart, nextProps.steps);
    }

    // Update keyboard listeners if necessary
    /* istanbul ignore else */
    if (
      !this.listeners.keyboard &&
      ((!keyboardNavigation && nextProps.keyboardNavigation) || keyboardNavigation)
      && nextProps.type === 'continuous'
    ) {
      this.listeners.keyboard = this.handleKeyboardNavigation;
      document.body.addEventListener('keydown', this.listeners.keyboard);
    }
    else if (
      this.listeners.keyboard && keyboardNavigation &&
      (!nextProps.keyboardNavigation || nextProps.type !== 'continuous')
    ) {
      document.body.removeEventListener('keydown', this.listeners.keyboard);
      delete this.listeners.keyboard;
    }
  }

  componentWillUpdate(nextProps, nextState) {
    const { index, isRunning, shouldRenderTooltip, standaloneData } = this.state;
    const { steps } = this.props;
    const { steps: nextSteps } = nextProps;
    const step = steps[index];
    const nextStep = nextSteps[nextState.index];
    const hasRenderedTarget = Boolean(this.getStepTargetElement(nextStep));

    // Standalone tooltip is being turned on
    if (!standaloneData && nextState.standaloneData) {
      this.triggerCallback({
        type: callbackTypes.STANDALONE_BEFORE,
        step: nextState.standaloneData
      });
    }
    // Standalone tooltip is being turned off
    else if (standaloneData && !nextState.standaloneData) {
      this.triggerCallback({
        type: callbackTypes.STANDALONE_AFTER,
        step: standaloneData
      });
    }

    // Tried to start, but something went wrong and we're not actually running
    if (nextState.action === 'start' && !nextState.isRunning) {
      // There's a step to use, but there's no target in the DOM
      if (nextStep && !hasRenderedTarget) {
        console.warn('Target not mounted', nextStep, nextState.action); //eslint-disable-line no-console
        this.triggerCallback({
          action: 'start',
          index: nextState.index,
          type: callbackTypes.TARGET_NOT_FOUND,
          step: nextStep,
        });
      }
    }

    // Started running from the beginning (the current index is 0)
    if ((!isRunning && nextState.isRunning) && nextState.index === 0) {
      this.triggerCallback({
        action: 'start',
        index: nextState.index,
        type: callbackTypes.STEP_BEFORE,
        step: nextStep
      });

      // Not showing a tooltip yet, so we're going to show a beacon instead
      /* istanbul ignore else */
      if (!nextState.shouldRenderTooltip) {
        this.triggerCallback({
          action: 'start',
          index: nextState.index,
          type: callbackTypes.BEACON_BEFORE,
          step: nextStep
        });
      }
    }

    // Joyride was running (it might still be), and the index has been changed
    if (isRunning && nextState.index !== index) {
      this.triggerCallback({
        action: nextState.action,
        index,
        type: callbackTypes.STEP_AFTER,
        step
      });

      // Attempted to advance to a step with a target that cannot be found
      /* istanbul ignore else */
      if (nextStep && !hasRenderedTarget) {
        console.warn('Target not mounted', nextStep, nextState.action); //eslint-disable-line no-console
        this.triggerCallback({
          action: nextState.action,
          index: nextState.index,
          type: callbackTypes.TARGET_NOT_FOUND,
          step: nextStep,
        });
      }
      // There's a next step and the index is > 0
      // (which means STEP_BEFORE wasn't sent as part of the start handler above)
      else if (nextStep && nextState.index) {
        this.triggerCallback({
          action: nextState.action,
          index: nextState.index,
          type: callbackTypes.STEP_BEFORE,
          step: nextStep
        });
      }
    }

    // Running, and a tooltip is being turned on/off or the index is changing
    if (nextState.isRunning && (shouldRenderTooltip !== nextState.shouldRenderTooltip || nextState.index !== index)) {
      // Going to show a tooltip
      if (nextState.shouldRenderTooltip) {
        this.triggerCallback({
          action: nextState.action || (nextState.index === 0 ? 'autostart' : ''),
          index: nextState.index,
          type: callbackTypes.TOOLTIP_BEFORE,
          step: nextStep
        });
      }
      // Going to show a beacon
      else {
        this.triggerCallback({
          action: nextState.action,
          index: nextState.index,
          type: callbackTypes.BEACON_BEFORE,
          step: nextStep
        });
      }
    }

    // Joyride was changed to a step index which doesn't exist (hit the end)
    if (!nextState.isRunning && nextSteps.length && index !== nextState.index && !nextStep) {
      this.triggerCallback({
        action: nextState.action,
        type: callbackTypes.FINISHED,
        steps: nextSteps,
        isTourSkipped: nextState.isTourSkipped
      });
    }
  }

  componentDidUpdate(prevProps, prevState) {
    const { index, shouldRedraw, isRunning, shouldRun, standaloneData } = this.state;
    const { scrollToFirstStep, scrollToSteps, steps } = this.props;
    const step = steps[index];
    const scrollTop = this.getScrollTop();
    const shouldScroll = (
      scrollToFirstStep || (index > 0 || prevState.index > index))
      && (step && !step.isFixed); // fixed steps don't need to scroll

    if (shouldRedraw && step) {
      this.calcPlacement();
    }

    if (isRunning && scrollToSteps && shouldScroll && scrollTop >= 0) {
      scroll.top(getRootEl(), this.getScrollTop());
    }

    if (steps.length && (!isRunning && shouldRun && !standaloneData)) {
      this.start();
    }
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.listeners.resize);

    /* istanbul ignore else */
    if (this.listeners.keyboard) {
      document.body.removeEventListener('keydown', this.listeners.keyboard);
    }

    /* istanbul ignore else */
    if (Object.keys(this.listeners.tooltips).length) {
      Object.keys(this.listeners.tooltips)
        .map(key => ({
          el: document.querySelector(key),
          event: this.listeners.tooltips[key].event,
          cb: this.listeners.tooltips[key].cb,
          key
        }))
        .filter(({ el }) => !!el)
        .forEach(({ el, event, cb, key }) => {
          el.removeEventListener(event, cb);
          delete this.listeners.tooltips[key];
        });
    }
  }

  /**
   * Starts the tour
   *
   * @private
   *
   * @param {boolean} [autorun] - Starts with the first tooltip opened
   * @param {Array} [steps] - Array of steps, defaults to this.props.steps
   * @param {number} [startIndex] - Optional step index to start joyride at
   */
  start(autorun, steps = this.props.steps, startIndex = this.state.index) {
    const hasMountedTarget = Boolean(this.getStepTargetElement(steps[startIndex]));
    const shouldRenderTooltip = (autorun === true) && hasMountedTarget;

    logger({
      type: 'joyride:start',
      msg: ['autorun:', autorun === true],
      debug: this.props.debug,
    });

    this.setState({
      action: 'start',
      index: startIndex,
      isRunning: Boolean(steps.length) && hasMountedTarget,
      shouldRenderTooltip,
      shouldRun: !steps.length,
    });
  }

  /**
   * Stop the tour
   *
   * @private
   */
  stop() {
    logger({
      type: 'joyride:stop',
      debug: this.props.debug,
    });

    this.setState({
      isRunning: false,
      shouldRenderTooltip: false
    });
  }

  /**
   * Move to the next step, if there is one.  If there is no next step, hide the tooltip.
   */
  next() {
    const { index, shouldRenderTooltip } = this.state;
    const { steps } = this.props;
    const nextIndex = index + 1;

    const shouldDisplay = Boolean(steps[nextIndex]) && shouldRenderTooltip;

    logger({
      type: 'joyride:next',
      msg: ['new index:', nextIndex],
      debug: this.props.debug,
    });
    this.toggleTooltip({ show: shouldDisplay, index: nextIndex, action: 'next' });
  }

  /**
   * Move to the previous step, if there is one.  If there is no previous step, hide the tooltip.
   */
  back() {
    const { index, shouldRenderTooltip } = this.state;
    const { steps } = this.props;
    const previousIndex = index - 1;

    const shouldDisplay = Boolean(steps[previousIndex]) && shouldRenderTooltip;

    logger({
      type: 'joyride:back',
      msg: ['new index:', previousIndex],
      debug: this.props.debug,
    });
    this.toggleTooltip({ show: shouldDisplay, index: previousIndex, action: 'next' });
  }

  /**
   * Reset Tour
   *
   * @param {boolean} [restart] - Starts the new tour right away
   */
  reset(restart) {
    const { index, isRunning } = this.state;
    const shouldRestart = restart === true;

    const newState = {
      ...defaultState,
      isRunning: shouldRestart,
      shouldRenderTooltip: this.props.autoStart,
    };

    logger({
      type: 'joyride:reset',
      msg: ['restart:', shouldRestart],
      debug: this.props.debug,
    });
    // Force a re-render if necessary
    if (shouldRestart && isRunning === shouldRestart && index === 0) {
      this.forceUpdate();
    }

    this.setState(newState);
  }

  /**
   * Retrieve the current progress of your tour
   *
   * @returns {{index: number, percentageComplete: number, step: (object|null)}}
   */
  getProgress() {
    const { index } = this.state;
    const { steps } = this.props;

    logger({
      type: 'joyride:getProgress',
      msg: ['steps:', steps],
      debug: this.props.debug,
    });

    return {
      index,
      percentageComplete: parseFloat(((index / steps.length) * 100).toFixed(2).replace('.00', '')),
      step: steps[index]
    };
  }

  /**
   * Add standalone tooltip events
   *
   * @param {Object} data - Similar shape to a 'step', but for a single tooltip
   */
  addTooltip(data) {
    if (!this.checkStepValidity(data)) {
      logger({
        type: 'joyride:addTooltip:FAIL',
        msg: ['data:', data],
        debug: this.props.debug,
      });

      return;
    }

    logger({
      type: 'joyride:addTooltip',
      msg: ['data:', data],
      debug: this.props.debug,
    });

    const key = data.trigger || sanitizeSelector(data.selector);
    const el = document.querySelector(key);

    if (!el) {
      return;
    }

    el.setAttribute('data-tooltip', JSON.stringify(data));
    const eventType = data.event || 'click';

    /* istanbul ignore else */
    if (eventType === 'hover') {
      this.listeners.tooltips[`${key}mouseenter`] = { event: 'mouseenter', cb: this.handleClickStandaloneTrigger };
      this.listeners.tooltips[`${key}mouseleave`] = { event: 'mouseleave', cb: this.handleClickStandaloneTrigger };

      el.addEventListener('mouseenter', this.listeners.tooltips[`${key}mouseenter`].cb);
      el.addEventListener('mouseleave', this.listeners.tooltips[`${key}mouseleave`].cb);
    }

    this.listeners.tooltips[`${key}click`] = { event: 'click', cb: this.handleClickStandaloneTrigger };
    el.addEventListener('click', this.listeners.tooltips[`${key}click`].cb);
  }

  /**
   * Parse the incoming steps
   *
   * @deprecated
   *
   * @param {Array|Object} steps
   * @returns {Array}
   */
  parseSteps(steps) {
    console.warn('joyride.parseSteps() is deprecated.  It is no longer necessary to parse steps before providing them to Joyride'); //eslint-disable-line no-console

    return steps;
  }

  /**
   * Verify that a step is valid
   *
   * @param {Object} step - A step object
   * @returns {boolean} - True if the step is valid, false otherwise
   */
  checkStepValidity(step) {
    // Check that the step is the proper type
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      logger({
        type: 'joyride:checkStepValidity',
        msg: 'Did not provide a step object.',
        warn: true,
        debug: this.props.debug,
      });

      return false;
    }

    // Check that all required step fields are present
    const requiredFields = ['selector'];
    const hasRequiredField = (requiredField) => {
      const hasField = Boolean(step[requiredField]);

      if (!hasField) {
        logger({
          type: 'joyride:checkStepValidity',
          msg: [`Provided a step without the required ${requiredField} property.`, 'Step:', step],
          warn: true,
          debug: this.props.debug,
        });
      }

      return hasField;
    };

    return requiredFields.every(hasRequiredField);
  }

  /**
   * Check one or more steps are valid
   *
   * @param {Object|Array} steps - A step object or array of step objects
   * @returns {boolean} - True if one or more stpes, and all steps are valid, false otherwise
   */
  checkStepsValidity(steps) {
    /* istanbul ignore else */
    if (!Array.isArray(steps) && typeof steps === 'object') {
      return this.checkStepValidity(steps);
    }
    else if (steps.length > 0) {
      return steps.every(this.checkStepValidity);
    }

    return false;
  }

  /**
   * Find and return the targeted DOM element based on a step's 'selector'.
   *
   * @private
   * @param {Object} step - A step object
   * @returns {Element} - A DOM element (if found)
   */
  getStepTargetElement(step) {
    const isValidStep = this.checkStepValidity(step);
    if (!isValidStep) {
      return null;
    }

    const el = document.querySelector(sanitizeSelector(step.selector));

    if (!el) {
      logger({
        type: 'joyride:getStepTargetElement',
        msg: 'Target not rendered. For best results only add steps after they are mounted.',
        warn: true,
        debug: this.props.debug,
      });

      return null;
    }

    return el;
  }

  /**
   * Get an element actual dimensions with margin
   *
   * @private
   * @returns {{height: number, width: number}}
   */
  getElementDimensions() {
    const { shouldRenderTooltip, standaloneData } = this.state;
    const displayTooltip = standaloneData ? true : shouldRenderTooltip;
    const el = document.querySelector(displayTooltip ? '.joyride-tooltip' : '.joyride-beacon');

    let height = 0;
    let width = 0;

    if (el) {
      const styles = window.getComputedStyle(el);
      height = el.clientHeight + parseInt(styles.marginTop || 0, 10) + parseInt(styles.marginBottom || 0, 10);
      width = el.clientWidth + parseInt(styles.marginLeft || 0, 10) + parseInt(styles.marginRight || 0, 10);
    }

    return {
      height,
      width
    };
  }

  /**
   * Get the scrollTop position
   *
   * @private
   * @returns {number}
   */
  getScrollTop() {
    const { index } = this.state;
    const { offsetParentSelector, scrollOffset, steps } = this.props;
    const step = steps[index];
    const target = this.getStepTargetElement(step);
    const offsetParent = document.querySelector(sanitizeSelector(offsetParentSelector));

    if (!target) {
      return 0;
    }

    const rect = getOffsetBoundingClientRect(target, offsetParent);
    const targetTop = rect.top + (window.pageYOffset || document.documentElement.scrollTop);
    return Math.floor(targetTop - scrollOffset);
  }

  /**
   * Get the scrollLeft position
   *
   * @private
   * @returns {number}
   */
  getScrollLeft(baseLeftPostition) { // get offset X of hole
    const { index } = this.state;
    const { offsetParentSelector, steps } = this.props;
    const step = steps[index];
    const target = this.getStepTargetElement(step);
    const offsetParent = document.querySelector(sanitizeSelector(offsetParentSelector));
    if (!target) return 0;
    const rect = getOffsetBoundingClientRect(target, offsetParent);
    return rect.left - baseLeftPostition;
  }

  /**
   * Trigger the callback.
   *
   * @private
   * @param {Object} options
   */
  triggerCallback(options) {
    const { callback } = this.props;

    /* istanbul ignore else */
    if (typeof callback === 'function') {
      logger({
        type: 'joyride:triggerCallback',
        msg: [options],
        debug: this.props.debug,
      });

      callback(options);
    }
  }

  /**
   * Keydown event listener
   *
   * @private
   * @param {Event} e - Keyboard event
   */
  handleKeyboardNavigation = (e) => {
    const { index, shouldRenderTooltip } = this.state;
    const { steps } = this.props;
    const intKey = (window.Event) ? e.which : e.keyCode;
    let hasSteps;

    if (shouldRenderTooltip) {
      if ([38, 40].indexOf(intKey) > -1) {
        e.preventDefault();
      }

      if (intKey === 27) {
        this.toggleTooltip({ show: false, index: index + 1, action: 'esc' });
      }
      else if ([13].indexOf(intKey) > -1) {
        document.getElementById('next_button_joyride').click();
      }
    }
  };

  /**
   * Tooltip event listener
   *
   * @private
   * @param {Event} e - Click event
   */
  handleClickStandaloneTrigger = (e) => {
    e.preventDefault();
    const { isRunning, standaloneData } = this.state;
    let tooltipData = e.currentTarget.dataset.tooltip;

    if (['mouseenter', 'mouseleave'].includes(e.type) && hasTouch) {
      return;
    }

    /* istanbul ignore else */
    if (tooltipData) {
      tooltipData = JSON.parse(tooltipData);

      if (!standaloneData || (standaloneData.selector !== tooltipData.selector)) {
        this.setState({
          isRunning: false,
          shouldRenderTooltip: false,
          shouldRun: isRunning,
          standaloneData: tooltipData,
          xPos: -1000,
          yPos: -1000
        });
      }
      else {
        document.querySelector('.joyride-tooltip__close').click();
      }
    }
  };

  /**
   * Beacon click event listener
   *
   * @private
   * @param {Event} e - Click event
   */
  handleClickBeacon = (e) => {
    e.preventDefault();
    const { index } = this.state;
    const { steps } = this.props;

    this.triggerCallback({
      action: e.type,
      index,
      type: callbackTypes.BEACON_TRIGGER,
      step: steps[index]
    });

    this.toggleTooltip({ show: true, index, action: `beacon:${e.type}` });
  };

  /**
   * Tooltip click event listener
   *
   * @private
   * @param {Event} e - Click event
   */
  handleClickTooltip = (e) => {
    const { index, shouldRun } = this.state;
    const { steps, type } = this.props;
    const el = e.currentTarget.className.includes('joyride-') && [
      'A',
      'BUTTON'
    ].includes(e.currentTarget.tagName) ? e.currentTarget : e.target;
    const dataType = el.dataset.type;

    /* istanbul ignore else */
    if (el.className.indexOf('joyride-') === 0) {
      e.preventDefault();
      e.stopPropagation();
      const tooltip = document.querySelector('.joyride-tooltip');
      let newIndex = index + (dataType === 'back' ? -1 : 1);

      if (dataType === 'skip') {
        this.setState({
          isTourSkipped: true
        });
        newIndex = steps.length + 1;
      }

      /* istanbul ignore else */
      if (tooltip.classList.contains('joyride-tooltip--standalone')) {
        this.setState({
          isRunning: shouldRun,
          shouldRedraw: true,
          shouldRun: false,
          standaloneData: false
        });
      }
      else if (dataType) {
        const shouldDisplay = ['continuous', 'guided'].indexOf(type) > -1
          && ['close', 'skip'].indexOf(dataType) === -1
          && Boolean(steps[newIndex]);

        this.toggleTooltip({ show: shouldDisplay, index: newIndex, action: dataType });
      }

      if (e.target.className === 'joyride-overlay') {
        this.triggerCallback({
          action: 'click',
          type: callbackTypes.OVERLAY,
          step: steps[index]
        });
      }

      if (e.target.classList.contains('joyride-hole')) {
        this.triggerCallback({
          action: 'click',
          type: callbackTypes.HOLE,
          step: steps[index]
        });
      }
    }
  };

  handleRenderTooltip = () => {
    this.calcPlacement();
  };

  /**
   * Toggle Tooltip's visibility
   *
   * @private
   * @param {Object} options - Immediately destructured argument object
   * @param {Boolean} options.show - Render the tooltip or the beacon
   * @param {Number} options.index - The tour's new index
   * @param {string} [options.action] - The action being undertaken.
   * @param {Array} [options.steps] - The array of step objects that is going to be rendered
   */
  toggleTooltip({ show, index = this.state.index, action, steps = this.props.steps }) {
    const nextStep = steps[index];
    const hasMountedTarget = Boolean(this.getStepTargetElement(nextStep));

    this.setState({
      action,
      index,
      // Stop playing if there is no next step or can't find the target
      isRunning: (nextStep && hasMountedTarget) ? this.state.isRunning : false,
      // If we are not showing now, or there is no target, we'll need to redraw eventually
      shouldRedraw: !show || !hasMountedTarget,
      shouldRenderTooltip: show && hasMountedTarget,
      xPos: -1000,
      yPos: -1000
    });
  }

  /**
   * Position absolute elements next to its target
   *
   * @private
   */
  calcPlacement() {
    const { index, isRunning, standaloneData } = this.state;
    const { steps, offsetParentSelector } = this.props;
    const step = standaloneData || (steps[index] || {});
    const target = this.getStepTargetElement(step);

    logger({
      type: `joyride:calcPlacement${this.getRenderStage()}`,
      msg: ['step:', step],
      debug: this.props.debug,
    });

    /* istanbul ignore else */
    if (!target) {
      return;
    }

    const placement = {
      x: -1000,
      y: -1000
    };

    /* istanbul ignore else */
    if (step && (standaloneData || (isRunning && steps[index]))) {
      const clientWidth = Math.max(document.body.clientWidth, 1280);
      const clientHeight = Math.max(document.body.clientHeight, 768);
      const isVirtualTarget = /^.tour-guide__placehold/.test(steps[index].selector);
      const scrollTop = isVirtualTarget ? 0 : (this.getScrollTop() - 85);
      const offsetParent = document.querySelector(sanitizeSelector(offsetParentSelector));
      if (!target) return;
      const rect = getOffsetBoundingClientRect(target, offsetParent);
      const popupHeight = 200;
      const popupWidth = 610;
      const paddingPopup = 20;
      const supperButtonBounding = document.querySelector('#super-button').getBoundingClientRect();
      if (/^ls_pd2/.test(steps[index].casecClass)) {
        const scrollLeft = isVirtualTarget ? 0 : this.getScrollLeft((clientWidth / 2) + 10);
        placement.x = ((clientWidth - 1260) / 2) + 10 + scrollLeft;
        placement.y = (0.4 * clientHeight) + scrollTop;
      } else if (/^center/.test(steps[index].casecClass)) {
        placement.x = (supperButtonBounding.right - (1240 / 2) - (popupWidth / 2));
        placement.y = ((Math.max(clientHeight, 900) / 2) - popupHeight) + supperButtonBounding.top;
      } else if (/^rd_popup2/.test(steps[index].casecClass)) {
        placement.x = rect.left;
        placement.y = rect.top + rect.height;
      } else if (/^rd_popup3/.test(steps[index].casecClass)) {
        placement.x = rect.left;
        placement.y = rect.top - popupHeight - paddingPopup;
      } else if (/^abs_left/.test(steps[index].casecClass)) {
        placement.x = rect.left - ((popupWidth - rect.width) + 15);
        placement.y = rect.top - popupHeight - paddingPopup;
      } else if (/^abs_top/.test(steps[index].casecClass)) {
        placement.x = rect.left - (popupWidth - rect.width - 10);
        placement.y = rect.top + rect.height + paddingPopup;
      } else if (/^sp_top/.test(steps[index].casecClass)) {
        placement.x = rect.left - ((popupWidth - rect.width) / 2);
        placement.y = rect.top + rect.height;
      } else if (/^wt_pd3/.test(steps[index].casecClass)) {
        placement.x = rect.left - 20;
        placement.y = rect.top + rect.height + paddingPopup;
      } else if (/^abs_wt/.test(steps[index].casecClass)) {
        placement.x = rect.left - (popupWidth - rect.width - 20);
        placement.y = rect.top + rect.height + paddingPopup;
      } else if (/^wt_st2/.test(steps[index].casecClass)) {
        placement.x = rect.left - (popupWidth + 20);
        placement.y = rect.top + ((rect.height - popupHeight) / 2);
      }

      this.setState({
        shouldRedraw: false,
        xPos: placement.x,
        yPos: placement.y
      });
    }
  }

  /**
   * Update position for overflowing elements.
   *
   * @private
   * @param {Object} step
   *
   * @returns {string}
   */
  calcPosition(step) {
    return step.position || DEFAULTS.position;
  }

  /**
   * Get the render stage.
   *
   * @private
   * @returns {string}
   */
  getRenderStage() {
    const { shouldRedraw, xPos } = this.state;

    if (shouldRedraw) {
      return ':redraw';
    }
    else if (xPos < 0) {
      return ':pre-render';
    }

    return '';
  }

  /**
   * Prevent tooltip to render outside the window
   *
   * @private
   * @param {Number} value - The axis position
   * @param {String} axis - The Axis X or Y
   * @param {Number} elWidth - The target element width
   * @param {Number} elHeight - The target element height
   * @returns {Number}
   */
  preventWindowOverflow(value, axis, elWidth, elHeight) {
    const winWidth = window.innerWidth;
    const docHeight = getDocHeight();
    let newValue = value;

    /* istanbul ignore else */
    if (axis === 'x') {
      if (value + elWidth >= winWidth) {
        newValue = winWidth - elWidth - 15;
      }
      else if (value < 15) {
        newValue = 15;
      }
    }
    else if (axis === 'y') {
      if (value + elHeight >= docHeight) {
        newValue = docHeight - elHeight - 15;
      }
      else if (value < 15) {
        newValue = 15;
      }
    }

    return newValue;
  }

  /**
   * Create a React Element
   *
   * @private
   * @returns {boolean|ReactComponent}
   */
  createComponent() {
    const { index, shouldRedraw, shouldRenderTooltip, standaloneData, xPos, yPos } = this.state;
    const {
      disableOverlay,
      holePadding,
      locale,
      offsetParentSelector,
      showBackButton,
      showOverlay,
      showSkipButton,
      showStepsProgress,
      steps,
      type
    } = this.props;
    const currentStep = standaloneData || steps[index];
    const step = { ...currentStep };

    const target = this.getStepTargetElement(step);
    let component;

    const allowClicksThruHole = (step && step.allowClicksThruHole) || this.props.allowClicksThruHole;
    const shouldShowOverlay = standaloneData ? false : showOverlay;
    const buttons = {
      primary: locale.close
    };

    logger({
      type: `joyride:createComponent${this.getRenderStage()}`,
      msg: [
        'component:', shouldRenderTooltip || standaloneData ? 'Tooltip' : 'Beacon',
        'animate:', xPos > -1 && !shouldRedraw,
        'step:', step
      ],
      debug: this.props.debug,
      warn: !target,
    });

    if (!target) {
      return false;
    }

    if (shouldRenderTooltip || standaloneData) {
      const position = this.calcPosition(step);

      /* istanbul ignore else */
      if (!standaloneData) {
        /* istanbul ignore else */
        if (['continuous', 'guided'].indexOf(type) > -1) {
          buttons.primary = locale.last;

          /* istanbul ignore else */
          if (steps[index + 1]) {
            if (showStepsProgress) {
              let { next } = locale;

              if (typeof locale.next === 'string') {
                next = (<span>{locale.next}</span>);
              }

              buttons.primary = (<span>{next} <span>{`${(index + 1)}/${steps.length}`}</span></span>);
            }
            else {
              buttons.primary = locale.next;
            }
          }

          if (showBackButton && index > 0) {
            buttons.secondary = locale.back;
          }
        }

        if (showSkipButton) {
          buttons.skip = locale.skip;
        }
      }

      component = React.createElement(Tooltip, {
        allowClicksThruHole,
        animate: xPos > -1000 && !shouldRedraw,
        buttons,
        disableOverlay,
        holePadding,
        offsetParentSelector,
        position,
        selector: sanitizeSelector(step.selector),
        showOverlay: shouldShowOverlay,
        step,
        standalone: Boolean(standaloneData),
        target,
        type,
        xPos,
        yPos,
        onClick: this.handleClickTooltip,
        onRender: this.handleRenderTooltip
      });
    }
    else {
      component = React.createElement(Beacon, {
        step,
        xPos,
        yPos,
        onTrigger: this.handleClickBeacon,
        eventType: step.type || 'click'
      });
    }

    return component;
  }

  render() {
    const { index, isRunning, standaloneData } = this.state;
    const { steps } = this.props;
    const hasStep = Boolean(steps[index]);
    let component;
    let standaloneComponent;

    if (isRunning && hasStep) {
      logger({
        type: `joyride:render${this.getRenderStage()}`,
        msg: ['step:', steps[index]],
        debug: this.props.debug,
      });
    }
    else if (!isRunning && standaloneData) {
      logger({
        type: 'joyride:render',
        msg: ['tooltip:', standaloneData],
        debug: this.props.debug,
      });
    }

    if (standaloneData) {
      standaloneComponent = this.createComponent();
    }
    else if (isRunning && hasStep) {
      component = this.createComponent();
    }

    return (
      <div className="joyride">
        {component}
        {standaloneComponent}
      </div>
    );
  }
}

export default Joyride;
