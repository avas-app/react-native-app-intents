// SPIKE (throwaway): entity tag lookup trial.
import type { ReactElement, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { findNodeHandle, NativeModules, Text, View } from "react-native";

interface Probe {
  found: boolean;
  class?: string;
  ptr?: string;
  accessibilityIdentifier?: string | null;
  nativeID?: string | null;
  hasAppEntityIdentifier?: boolean;
  inWindow?: boolean;
  via?: string;
  note?: string;
}

// A: cleanup by saved tag, B: no cleanup, C: no cleanup + prepareForRecycle swizzle
const MODE: "A" | "B" | "C" = "C";

const mod = NativeModules.ReactNativeAppIntents as {
  spikeTagView: (tag: number, value: string) => Promise<Probe>;
  spikeSwizzle: (on: boolean) => Promise<boolean>;
};

const lines: string[] = [];
let render: (() => void) | null = null;
function log(msg: string): void {
  lines.push(msg);
  console.log(`SPIKE ${msg}`);
  render?.();
}

async function probe(ref: RefObject<View | null>, value: string): Promise<Probe> {
  const tag = findNodeHandle(ref.current);
  if (tag == null) return { found: false, note: "ref null" };
  return mod.spikeTagView(tag, value);
}

const fmt = (p: Probe): string =>
  p.found
    ? `${p.class} via=${p.via} ptr=${p.ptr} axId=${p.accessibilityIdentifier} nativeID=${p.nativeID} inWindow=${p.inWindow} appEntityId=${p.hasAppEntityIdentifier}`
    : `NOT FOUND ${p.note ?? ""}`;

function Tagged(props: { name: string; flatten?: boolean; nid?: boolean; value: string; bump: number }): ReactElement {
  const ref = useRef<View>(null);
  const tagRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    void probe(ref, props.value).then((p) => log(`${props.name} layoutEffect: ${fmt(p)}`));
  }, []);
  useEffect(() => {
    tagRef.current = findNodeHandle(ref.current);
    void probe(ref, props.value).then((p) => log(`${props.name} effect(bump=${props.bump}): ${fmt(p)}`));
    return () => {
      const tag = tagRef.current;
      log(`${props.name} cleanup: ref.current=${ref.current == null ? "null" : "set"} tag=${tag}`);
      if (tag != null) void mod.spikeTagView(tag, "__CLEAR__").then((p) => log(`${props.name} cleanup by tag: ${fmt(p)}`));
    };
  }, [props.bump]);
  return (
    <View ref={ref} collapsable={props.flatten ? undefined : false} nativeID={props.nid === false ? undefined : `nid-${props.name}`}
      style={props.flatten ? { margin: 2 } : { height: 20, backgroundColor: "#cde" }}>
      {props.flatten ? <Text>flatten candidate</Text> : null}
    </View>
  );
}

const rowRefs = new Map<number, RefObject<View | null>>();

function Row(props: { index: number; clear: boolean }): ReactElement {
  const ref = useRef<View>(null);
  const tagged = props.index % 3 !== 0;
  useEffect(() => {
    rowRefs.set(props.index, ref);
    const tag = findNodeHandle(ref.current);
    if (tagged) void probe(ref, `row-${props.index}`);
    return () => {
      rowRefs.delete(props.index);
      if (tagged && props.clear && tag != null) void mod.spikeTagView(tag, "__CLEAR__");
    };
  }, [props.index, tagged, props.clear]);
  return (
    <View ref={ref} collapsable={false} style={{ height: 60, backgroundColor: tagged ? "#dfd" : "#eee" }}>
      <Text>{`row ${props.index} ${tagged ? "tagged" : "UNTAGGED"}`}</Text>
    </View>
  );
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const seenPtr = new Map<string, string>();
async function audit(label: string): Promise<void> {
  const currentPtr = new Set<string>();
  let stale = 0;
  let total = 0;
  let recycled = 0;
  for (const [index, ref] of rowRefs) {
    const p = await probe(ref, "");
    total++;
    if (p.ptr && seenPtr.has(p.ptr) && seenPtr.get(p.ptr) !== `${label}:${index}` && !currentPtr.has(p.ptr)) recycled++;
    if (p.ptr) currentPtr.add(p.ptr);
    const expected = index % 3 !== 0 ? `row-${index}` : null;
    const got = p.accessibilityIdentifier ?? null;
    if (got !== expected) {
      stale++;
      log(`${label} MISMATCH row ${index}: expected ${expected} got ${got} (${p.class} ${p.ptr})`);
    }
  }
  for (const ptr of currentPtr) seenPtr.set(ptr, label);
  log(`${label}: ${total} mounted rows, ${stale} mismatches, ${recycled} on a view used before`);
}

export default function SpikeScreen(): ReactElement {
  const [, setTick] = useState(0);
  const [bump, setBump] = useState(0);
  const [show, setShow] = useState(true);
  const clear = MODE === "A";
  const [listKey, setListKey] = useState(0);
  const [start, setStart] = useState(0);
  const scrollTo = (y: number): void => setStart(Math.round(y / 60));
  render = () => setTick((t) => t + 1);

  useEffect(() => {
    void (async () => {
      await wait(3000);
      log("== rerender");
      setBump(1);
      await wait(1500);
      log(`== MODE ${MODE}`);
      if (MODE === "C") log(`swizzle installed: ${await mod.spikeSwizzle(true)}`);
      setListKey(1);
      await wait(1500);
      await audit("initial");
      for (const y of [480, 1200, 3000, 60, 1200, 3000, 480]) {
        scrollTo(y);
        await wait(1200);
        await audit(`offset ${y}`);
      }
      log("== unmount standalone views");
      setShow(false);
      await wait(1000);
      log("== DONE");
    })();
  }, []);

  return (
    <View style={{ flex: 1, paddingTop: 60 }}>
      {show ? (
        <>
          <Tagged name="solid" value="solid-1" bump={bump} />
          <Tagged name="flat" flatten value="flat-1" bump={bump} />
          <Tagged name="flatNoNid" flatten nid={false} value="flat-2" bump={bump} />
        </>
      ) : null}
      <View key={listKey} style={{ height: 240, overflow: "hidden" }}>
        {Array.from({ length: 8 }, (_, i) => start + i).map((i) => (
          <Row key={i} index={i} clear={clear} />
        ))}
      </View>
      <Text style={{ fontSize: 9 }}>{lines.slice(-14).join("\n")}</Text>
    </View>
  );
}
