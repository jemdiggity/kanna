// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PeerPickerModal from "../PeerPickerModal.vue";

describe("PeerPickerModal", () => {
  it("shows an explicit empty state when no machines are discovered", () => {
    const wrapper = mount(PeerPickerModal, {
      props: {
        peers: [],
        loading: false,
      },
      global: {
        mocks: {
          $t: (key: string) =>
            ({
              "taskTransfer.pushToMachine": "Push to Machine",
              "taskTransfer.pairPeer": "Pair Machine",
              "taskTransfer.noPeersFound": "No machines found on your network yet.",
              "actions.cancel": "Cancel",
              "common.loading": "Loading...",
            })[key] ?? key,
        },
      },
    });

    expect(wrapper.text()).toContain("No machines found on your network yet.");
    expect(wrapper.find(".peer-row").exists()).toBe(false);
  });

  it("does not render a pair action inside the push-to-machine picker", () => {
    const wrapper = mount(PeerPickerModal, {
      props: {
        peers: [{
          id: "peer-1",
          name: "Peer 1",
          trusted: true,
          acceptingTransfers: true,
        }],
        loading: false,
      },
      global: {
        mocks: {
          $t: (key: string) =>
            ({
              "taskTransfer.pushToMachine": "Push to Machine",
              "taskTransfer.pairPeer": "Pair Machine",
              "taskTransfer.noPeersFound": "No machines found on your network yet.",
              "actions.cancel": "Cancel",
              "common.loading": "Loading...",
            })[key] ?? key,
        },
      },
    });

    expect(wrapper.text()).not.toContain("Pair Machine");
    expect(wrapper.findAll("button").some((button) => button.text() === "Pair Machine")).toBe(false);
  });
});
