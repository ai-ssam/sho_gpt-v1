export function drawMeasurementSector(ctx,width,height,frame,arm,code,angle){
 const p=frame.corrected,s=p?.[arm+'_shoulder'],e=p?.[arm+'_elbow'],h=p?.[arm+'_hip'],w=p?.[arm+'_wrist'];
 const valid=q=>q&&Number.isFinite(q.x)&&Number.isFinite(q.y)&&(q.status==='manual'||(q.visibility??0)>=.45);
 const elbow=['BIR','IRER'].includes(code),center=elbow?e:s,a=elbow?s:h,b=elbow?w:e;
 if(![center,a,b].every(valid)||code==='CIR')return false;
 const x=center.x*width,y=center.y*height,r=Math.max(18,Math.min(width,height)*.085),start=Math.atan2((a.y-center.y)*height,(a.x-center.x)*width);
 let sweep=Math.atan2((b.y-center.y)*height,(b.x-center.x)*width)-start;
 while(sweep>Math.PI)sweep-=Math.PI*2;while(sweep< -Math.PI)sweep+=Math.PI*2;
 if(code==='IRER'){if(!Number.isFinite(angle))return false;sweep=Math.max(0,Math.min(180,angle))*Math.PI/180;}
 ctx.save();ctx.beginPath();ctx.moveTo(x,y);ctx.arc(x,y,r,start,start+sweep,sweep<0);ctx.closePath();ctx.fillStyle='rgba(255,196,64,.38)';ctx.fill();ctx.strokeStyle='#ffc440';ctx.lineWidth=Math.max(2,width/400);ctx.stroke();
 ctx.beginPath();ctx.setLineDash([4,4]);ctx.arc(x,y,r,start,start+(sweep<0?-Math.PI:Math.PI),sweep<0);ctx.strokeStyle='rgba(255,230,160,.7)';ctx.stroke();ctx.setLineDash([]);
 const value=code==='IRER'?angle:Math.abs(sweep)*180/Math.PI;ctx.font=`700 ${Math.max(13,width/55)}px system-ui`;ctx.fillStyle='#ffe6a0';ctx.strokeStyle='#16221e';ctx.lineWidth=3;const text=value.toFixed(1)+'°'+(code==='IRER'?' (2D 길이비)':'');ctx.strokeText(text,x+r+8,y);ctx.fillText(text,x+r+8,y);ctx.restore();return true;
}
export function drawIRERGuides(ctx,width,height,frame,arm){
 const s=frame.corrected?.[arm+'_shoulder'],e=frame.corrected?.[arm+'_elbow'],w=frame.corrected?.[arm+'_wrist'];if(!s||!e||!w)return;
 ctx.save();ctx.strokeStyle='#ffd071';ctx.lineWidth=2;ctx.setLineDash([6,5]);ctx.beginPath();ctx.moveTo(s.x*width,Math.max(0,(s.y-.1)*height));ctx.lineTo(s.x*width,Math.min(height,(e.y+.15)*height));ctx.moveTo(Math.min(s.x,e.x,w.x)*width-20,e.y*height);ctx.lineTo(Math.max(s.x,e.x,w.x)*width+20,e.y*height);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(e.x*width,e.y*height);ctx.lineTo(w.x*width,e.y*height);ctx.stroke();ctx.restore();
}
