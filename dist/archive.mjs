// ZIP STORE: browser-native Blob parts; CRC is streamed to avoid base64 copies.
const encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
async function crc32(blob){let crc=0xffffffff;const reader=blob.stream().getReader();try{while(true){const {done,value}=await reader.read();if(done)break;for(const b of value)crc=table[(crc^b)&255]^(crc>>>8);}}finally{reader.releaseLock();}return (crc^0xffffffff)>>>0;}
export async function createArchive(entries){
 if(entries.length>65535)throw Error('ZIP 파일 수 제한을 초과했습니다.');
 const parts=[],central=[];let offset=0,centralSize=0;
 for(const {name,blob}of entries){
  if(blob.size>0xffffffff||offset+blob.size>0xffffffff)throw Error('백업은 4 GB 미만이어야 합니다. 영상을 개별 저장하세요.');
  const n=encoder.encode(name),crc=await crc32(blob);
  const header=new Uint8Array(30+n.length),d=new DataView(header.buffer);
  d.setUint32(0,0x04034b50,true);d.setUint16(4,20,true);d.setUint16(6,0x800,true);d.setUint32(14,crc,true);d.setUint32(18,blob.size,true);d.setUint32(22,blob.size,true);d.setUint16(26,n.length,true);header.set(n,30);
  const c=new Uint8Array(46+n.length),v=new DataView(c.buffer);
  v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint32(16,crc,true);v.setUint32(20,blob.size,true);v.setUint32(24,blob.size,true);v.setUint16(28,n.length,true);v.setUint32(42,offset,true);c.set(n,46);
  parts.push(header,blob);central.push(c);centralSize+=c.length;offset+=header.length+blob.size;
 }
 const end=new Uint8Array(22),d=new DataView(end.buffer);d.setUint32(0,0x06054b50,true);d.setUint16(8,entries.length,true);d.setUint16(10,entries.length,true);d.setUint32(12,centralSize,true);d.setUint32(16,offset,true);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}

