import { WebDriverClient } from "./webdriver";
import { getSecondaryWebDriverPort, getWebDriverPort } from "./webdriverPort";

export interface TwoInstanceClients {
  primary: WebDriverClient;
  secondary: WebDriverClient;
}

export function createPrimaryAndSecondaryClients(): TwoInstanceClients {
  return {
    primary: new WebDriverClient(getWebDriverPort()),
    secondary: new WebDriverClient(getSecondaryWebDriverPort()),
  };
}
