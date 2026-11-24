import { expect } from "bun:test";
import { deflateSync } from "zlib";
import { sloink, unsloink } from ".";

const time = <T>(f: () => T): [T, number] => {
    const start = performance.now();
    const value = f();
    const end = performance.now();
    return [value, end - start];
};

const step = 100_000;
const items: any[] = [];
for (let count = 0; count < 1_000_000; count += step) {
    for (let i = 0; i < step; i++) {
        items.push({ type: "event", event: "NoteData", data: items.length });
    }
    const [serialized, serializedTime] = time(() =>
        JSON.stringify(sloink(items)),
    );
    const [roundTripped, roundTripTime] = time(() =>
        unsloink(JSON.parse(serialized)),
    );
    expect(roundTripped).toEqual(items);
    console.log(
        "serialize time = %o deserialize time = %o",
        serializedTime,
        roundTripTime,
    );
    const plain = JSON.stringify(items);
    console.log(
        "count = %o serialized = %o, plain = %o (%o%)",
        items.length,
        serialized.length,
        plain.length,
        100 * (serialized.length / plain.length),
    );
    for (let i = 0; i <= 9; i++) {
        const [serializedDeflate, serializedDeflateTime] = time(() =>
            deflateSync(serialized, { level: i }),
        );
        const [plainDeflate, plainDeflateTime] = time(() =>
            deflateSync(plain, { level: i }),
        );
        console.log(
            "deflate serialized time = %o plain deflate time = %o",
            serializedDeflateTime,
            plainDeflateTime,
        );
        console.log(
            "count = %d level %o serializedDeflate = %o, plainDeflate = %o (%o%)",
            items.length,
            i,
            serializedDeflate.length,
            plainDeflate.length,
            100 * (serializedDeflate.length / plainDeflate.length),
        );
    }
}
