import {
  getRenewal,
  postInvoiceIDToRenewal,
  postPaymentMethodToStripeAccount,
  postRenewalIDToProcessPayment,
} from "./stripe/contracts-api.js";

import { parseForErrorObject } from "./stripe/error-handler.js";

import {
  setPaymentInformation,
  setRenewalInformation,
} from "./stripe/set-modal-info.js";

const modal = document.getElementById("renewal-modal");

const form = document.getElementById("details-form");
const errorDialog = document.getElementById("payment-error-dialog");
const progressIndicator = document.getElementById("js-progress-indicator");

const addPaymentMethodButton = modal.querySelector(".js-payment-method");
const processPaymentButton = modal.querySelector(".js-process-payment");
const changePaymentMethodButton = modal.querySelector(
  ".js-change-payment-method"
);
const cancelModalButton = modal.querySelector(".js-cancel-modal");
const closeModalButton = modal.querySelector(".js-close-modal");

const cardErrorElement = document.getElementById("card-errors");
const renewalErrorElement = document.getElementById("renewal-errors");

// initialise Stripe
const stripe = window.Stripe("pk_test_yndN9H0GcJffPe0W58Nm64cM00riYG4N46");

// customise the Stripe card field
const style = {
  base: {
    iconColor: "#e95420",
    color: "#111",
    fontWeight: 300,
    fontFamily:
      '"Ubuntu", -apple-system, "Segoe UI", "Roboto", "Oxygen", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    fontSmoothing: "antialiased",
    fontSize: "18px",
    "::placeholder": {
      color: "#666",
    },
    ":-webkit-autofill": {
      color: "#666",
    },
  },
};

// create the Stripe card input, and apply the style to it
const elements = stripe.elements();
const card = elements.create("card", { style });

const activeRenewal = {
  accountId: null,
  contractId: null,
  renewalId: null,
};

let customerInfo = {
  name: null,
  email: null,
  country: null,
  address: null,
};

let cardValid = false;
let changingPaymentMethod = false;
let submitted3DS = false;

let mode = "payment_method";

let pollingTimer;
let progressTimer;
let progressTimer2;
let progressTimer3;
let progressTimer4;

function attachCTAevents(selector) {
  const renewalCTAs = document.querySelectorAll(selector);

  renewalCTAs.forEach((cta) => {
    cta.addEventListener("click", () => {
      let renewalData = cta.dataset;

      toggleModal();
      sendGAEvent("opened payment modal");
      activeRenewal.accountId = renewalData.accountId;
      activeRenewal.contractId = renewalData.contractId;
      activeRenewal.renewalId = renewalData.renewalId;

      setRenewalInformation(renewalData, modal);
    });
  });
}

function attachFormEvents() {
  for (let i = 0; i < form.elements.length; i++) {
    const input = form.elements[i];

    input.addEventListener("input", (e) => {
      validateFormInput(e.target, false);
    });

    input.addEventListener("blur", (e) => {
      validateFormInput(e.target, true);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      if (!addPaymentMethodButton.disabled) {
        addPaymentMethodButton.click();
      }
    });
  }
}

function attachModalButtonEvents() {
  addPaymentMethodButton.addEventListener("click", (e) => {
    e.preventDefault();
    sendGAEvent("submitted payment details");
    createPaymentMethod();
  });

  processPaymentButton.addEventListener("click", (e) => {
    e.preventDefault();
    sendGAEvent("clicked 'Pay'");
    processStripePayment();
  });

  changePaymentMethodButton.addEventListener("click", (e) => {
    e.preventDefault();
    changingPaymentMethod = true;
    card.clear();
    showPaymentMethodDialog();
  });

  cancelModalButton.addEventListener("click", (e) => {
    e.preventDefault();

    if (changingPaymentMethod) {
      changingPaymentMethod = false;
      form.elements["address"].value = customerInfo.address;
      form.elements["Country"].value = customerInfo.country;
      form.elements["email"].value = customerInfo.email;
      form.elements["name"].value = customerInfo.name;
      showPayDialog();
    } else {
      sendGAEvent("exited payment modal (clicked cancel)");
      resetModal();
      toggleModal();
    }
  });

  closeModalButton.addEventListener("click", (e) => {
    e.preventDefault();

    sendGAEvent("exited payment modal (clicked close)");
    resetModal();
    toggleModal();
  });

  document.addEventListener("keyup", (e) => {
    if (
      e.key === "Escape" &&
      document.body.classList.contains("p-modal--active")
    ) {
      sendGAEvent("exited payment modal (pressed escape key)");
      resetModal();
      toggleModal();
    }
  });
}

function clearProgressTimers() {
  clearTimeout(progressTimer);
  clearTimeout(progressTimer2);
  clearTimeout(progressTimer3);
  clearTimeout(progressTimer4);
}

function createPaymentMethod() {
  let formData = new FormData(form);

  customerInfo.address = formData.get("address");
  customerInfo.email = formData.get("email");
  customerInfo.country = formData.get("Country");
  customerInfo.name = formData.get("name");

  mode = "payment_method";
  enableProcessingState();

  stripe
    .createPaymentMethod({
      type: "card",
      card: card,
      billing_details: {
        name: customerInfo.name,
        email: customerInfo.email,
        address: {
          country: customerInfo.country,
          line1: customerInfo.address,
        },
      },
    })
    .then((result) => {
      if (result.paymentMethod) {
        console.log(result);
        handlePaymentMethodResponse(result.paymentMethod);
      } else {
        console.log(result);
        const errorObject = parseForErrorObject(result.error);

        if (result.error.type === "validation_error") {
          presentError(errorObject);
        } else {
          presentError(errorObject);
        }
      }
    })
    .catch((error) => {
      console.error(error);
      disableProcessingState();
      presentError();
    });
}

function disableProcessingState() {
  clearProgressTimers();
  resetProgressIndicator();
  cancelModalButton.disabled = false;
}

function enableProcessingState() {
  addPaymentMethodButton.disabled = true;
  cancelModalButton.disabled = true;
  processPaymentButton.disabled = true;

  // show a progress indicator that evolves over time
  progressTimer = setTimeout(() => {
    progressIndicator.classList.remove("u-hide");

    progressTimer2 = setTimeout(() => {
      if (mode === "payment") {
        progressIndicator.querySelector("span").innerHTML = "Making payment...";
      } else if (mode === "payment_method") {
        progressIndicator.querySelector("span").innerHTML = "Saving details...";
      }

      progressTimer3 = setTimeout(() => {
        progressIndicator.querySelector("span").innerHTML = "Still trying...";

        progressTimer4 = setTimeout(() => {
          // the renewal is taking time to process, reload the page
          // and highlight the in-progress renewal
          if (mode === "payment") {
            location.search = `subscription=${activeRenewal.contractId}`;
          }
        }, 15000);
      }, 11000);
    }, 2000);
  }, 2000);
}

function handleIncompletePayment(invoice) {
  if (invoice.pi_status === "requires_payment_method") {
    // the user's original payment method failed,
    // capture a new payment method, then post the
    // renewal invoice number to trigger another
    // payment attempt
    postInvoiceIDToRenewal(activeRenewal.renewalId, invoice.invoice_id)
      .then((data) => {
        if (data.message) {
          const errorObject = parseForErrorObject(data);

          if (errorObject) {
            presentError(errorObject);
          } else {
            pollRenewalStatus();
          }
        } else {
          pollRenewalStatus();
        }
      })
      .catch((error) => {
        console.error(error);
        pollRenewalStatus();
      });
  } else if (requiresAuthentication(invoice)) {
    // 3DS has been requested by Stripe
    clearTimeout(pollingTimer);
    stripe.confirmCardPayment(invoice.pi_secret).then(function (result) {
      submitted3DS = true;

      if (result.error) {
        presentError(result.error.message);
        submitted3DS = false;
      } else {
        pollRenewalStatus();
      }
    });
  } else {
    presentError();
  }
}

function handleIncompleteRenewal(renewal) {
  let invoice;
  let paymentIntentStatus;
  let subscriptionStatus;

  if (renewal.stripeInvoices) {
    invoice = renewal.stripeInvoices[renewal.stripeInvoices.length - 1];
    paymentIntentStatus = invoice.pi_status;
    subscriptionStatus = invoice.subscription_status;
  }

  if (
    !subscriptionStatus ||
    !paymentIntentStatus ||
    subscriptionStatus === "active" ||
    submitted3DS
  ) {
    clearTimeout(pollingTimer);

    pollingTimer = setTimeout(() => {
      pollRenewalStatus();
    }, 3000);
  } else if (subscriptionStatus !== "active") {
    handleIncompletePayment(invoice);
  }
}

function handlePaymentMethodResponse(paymentMethod) {
  postPaymentMethodToStripeAccount(paymentMethod.id, activeRenewal.accountId)
    .then((data) => {
      if (data.message) {
        // ua-contracts returned an error with information for us to parse
        const errorObject = parseForErrorObject(data);
        presentError(errorObject);
      } else if (data.createdAt) {
        // payment method was successfully attached,
        // ask user to click "Pay"
        setPaymentInformation(paymentMethod, modal);
        showPayDialog();
      } else {
        // an unexpected error occurred
        presentError();
      }
    })
    .catch((data) => {
      const errorObject = parseForErrorObject(data);
      presentError(errorObject);
    });
}

function handleSuccessfulPayment() {
  sendGAEvent("payment succeeded");
  clearProgressTimers();
  progressIndicator.querySelector(".p-icon--spinner").classList.add("u-hide");
  progressIndicator
    .querySelector(".p-icon--success")
    .classList.remove("u-hide");
  progressIndicator.querySelector("span").innerHTML = "Payment complete";
  progressIndicator.classList.remove("u-hide");

  location.search = `subscription=${activeRenewal.contractId}`;
}

function hideErrors() {
  cardErrorElement.innerHTML = "";
  cardErrorElement.classList.add("u-hide");
  renewalErrorElement.querySelector(".p-notification__message").innerHTML = "";
  renewalErrorElement.classList.add("u-hide");
}

function pollRenewalStatus() {
  getRenewal(activeRenewal.renewalId)
    .then((renewal) => {
      if (renewal.status !== "done") {
        handleIncompleteRenewal(renewal);
      } else {
        handleSuccessfulPayment();
      }
    })
    .catch((error) => {
      console.error(error);
      presentError();
    });
}

export function presentError(errorObject) {
  if (!errorObject) {
    errorObject = {
      message:
        "Sorry, there was an unknown error with the payment. Check the details and try again. Contact <a href='https://ubuntu.com/contact-us'>Canonical sales</a> if the problem persists.",
      type: "notification",
    };
  }

  console.log(errorObject);

  if (errorObject.type === "card") {
    cardErrorElement.innerHTML = errorObject.message;
    cardErrorElement.classList.remove("u-hide");
    showPaymentMethodDialog();
  } else if (errorObject.type === "notification") {
    renewalErrorElement.querySelector(".p-notification__message").innerHTML =
      errorObject.message;
    renewalErrorElement.classList.remove("u-hide");
    showPaymentMethodDialog();
  } else if (errorObject.type === "dialog") {
    disableProcessingState();
    modal.classList.remove("is-pay-mode", "is-details-mode");
    modal.classList.add("is-dialog-mode");
    errorDialog.innerHTML = errorObject.message;
    processPaymentButton.disabled = true;
    processPaymentButton.disabled = true;
  }
}

function processStripePayment() {
  mode = "payment";
  enableProcessingState();

  postRenewalIDToProcessPayment(activeRenewal.renewalId)
    .then((data) => {
      if (data.code) {
        const errorObject = parseForErrorObject(data);

        if (errorObject) {
          sendGAEvent("payment failed");
          presentError(errorObject);
        } else {
          pollRenewalStatus();
        }
      } else {
        pollRenewalStatus();
      }
    })
    .catch((error) => {
      console.error(error);
      sendGAEvent("payment failed");
      presentError();
    });
}

function requiresAuthentication(invoice) {
  if (invoice.pi_decline_code) {
    if (invoice.pi_decline_code === "authentication_required") {
      return true;
    }
  }

  if (invoice.pi_status === "requires_action" && invoice.pi_secret) {
    return true;
  }

  return false;
}

function resetModal() {
  form.reset();
  card.clear();
  resetProgressIndicator();
  modal.classList.remove("is-dialog-mode", "is-pay-mode");
  modal.classList.add("is-details-mode");
  addPaymentMethodButton.disabled = true;
  processPaymentButton.disabled = true;

  customerInfo = {
    name: null,
    email: null,
    country: null,
    address: null,
  };
}

function resetProgressIndicator() {
  progressIndicator
    .querySelector(".p-icon--spinner")
    .classList.remove("u-hide");
  progressIndicator.querySelector(".p-icon--success").classList.add("u-hide");
  progressIndicator.querySelector("span").innerHTML = "";
  progressIndicator.classList.add("u-hide");
}

function sendGAEvent(label) {
  dataLayer.push({
    event: "GAEvent",
    eventCategory: "advantage",
    eventAction: "renewal",
    eventLabel: label,
    eventValue: undefined,
  });
}

function setupCardElements() {
  card.mount("#card-element");

  card.on("change", (event) => {
    if (event.error) {
      const errorObject = parseForErrorObject(event.error);
      cardValid = false;
      addPaymentMethodButton.disabled = true;
      presentError(errorObject);
    } else if (event.complete) {
      cardValid = true;
      hideErrors();
      validateForm();
    }
  });
}

function showPaymentMethodDialog() {
  disableProcessingState();
  modal.classList.remove("is-pay-mode", "is-dialog-mode");
  modal.classList.add("is-details-mode");
  processPaymentButton.disabled = true;
  validateForm();
}

function showPayDialog() {
  hideErrors();
  disableProcessingState();
  modal.classList.remove("is-details-mode", "is-dialog-mode");
  modal.classList.add("is-pay-mode");
  addPaymentMethodButton.disabled = true;
  processPaymentButton.disabled = false;
}

function toggleModal() {
  if (modal && modal.classList.contains("p-modal")) {
    modal.classList.toggle("u-hide");
    document.documentElement.classList.toggle("p-modal--active");
  }
}

function validateForm() {
  const inputs = form.elements;
  let inputsValidity = [cardValid];

  for (let i = 0; i < inputs.length; i++) {
    const isValid = inputs[i].checkValidity();
    inputsValidity.push(isValid);
  }

  if (inputsValidity.includes(false)) {
    addPaymentMethodButton.disabled = true;
  } else {
    addPaymentMethodButton.disabled = false;
  }
}

function validateFormInput(input, callout) {
  const wrapper = input.closest(".p-form-validation");
  let valid = false;

  if (wrapper) {
    const messageEl = wrapper.querySelector(".p-form-validation__message");

    if (!input.checkValidity()) {
      if (callout) {
        wrapper.classList.add("is-error");
        messageEl.classList.remove("u-hide");
        messageEl.innerHTML = input.validationMessage;
      }
    } else {
      wrapper.classList.remove("is-error");
      messageEl.classList.add("u-hide");
      messageEl.innerHTML = "";

      valid = true;
    }

    validateForm();
  }

  return valid;
}

attachCTAevents(".js-renewal-cta");
attachFormEvents();
attachModalButtonEvents();
setupCardElements();
validateForm();