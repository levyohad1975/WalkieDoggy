import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';
import { localDateOnly } from '../logic/dateFormat';

interface DatePickerFieldProps {
  value: string;
  onChange: (date: string) => void;
  label?: string;
  allowEmpty?: boolean;
}


const pad2 = (n:number) => String(n).padStart(2,'0');

function parse(value:string): Date {
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12) : new Date();
}
function display(value:string) {
  if (!value) return 'בחירת תאריך';
  const d=parse(value); return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()}`;
}
export function DatePickerField({value,onChange,label='בחירת תאריך',allowEmpty=false}:DatePickerFieldProps) {
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState(parse(value));
  useEffect(()=>{ if(open) setDraft(parse(value)); },[open,value]);
  const years=useMemo(()=>{const y=new Date().getFullYear();return Array.from({length:21},(_,i)=>y-5+i);},[]);
  const days=useMemo(()=>Array.from({length:new Date(draft.getFullYear(),draft.getMonth()+1,0).getDate()},(_,i)=>i+1),[draft]);
  const setPart=(y:number,m:number,d:number)=>setDraft(new Date(y,m,Math.min(d,new Date(y,m+1,0).getDate()),12));
  const quick=(offset:number)=>{const d=new Date();d.setDate(d.getDate()+offset);setDraft(d);};
  return <>
    <Pressable style={s.field} onPress={()=>setOpen(true)} accessibilityRole="button" accessibilityLabel={label}>
      <RtlText style={s.fieldText}>{display(value)}</RtlText>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
      <View style={s.backdrop}><Pressable style={StyleSheet.absoluteFill} onPress={()=>setOpen(false)} />
        <View style={s.card}>
          <RtlText style={s.title}>{label}</RtlText>
          <View style={s.quick}><Button compact label="אתמול" variant="secondary" onPress={()=>quick(-1)} style={s.flex}/><Button compact label="היום" variant="secondary" onPress={()=>quick(0)} style={s.flex}/><Button compact label="מחר" variant="secondary" onPress={()=>quick(1)} style={s.flex}/></View>
          <View style={s.columnLabels}><RtlText style={s.columnLabel}>יום</RtlText><RtlText style={s.columnLabel}>חודש</RtlText><RtlText style={s.columnLabel}>שנה</RtlText></View>
          <View style={s.columns}>
            <Column values={days} selected={draft.getDate()} text={n=>String(n)} onSelect={d=>setPart(draft.getFullYear(),draft.getMonth(),d)}/>
            <Column values={Array.from({length:12},(_,i)=>i)} selected={draft.getMonth()} text={m=>pad2(m+1)} wide onSelect={m=>setPart(draft.getFullYear(),m,draft.getDate())}/>
            <Column values={years} selected={draft.getFullYear()} text={y=>String(y)} onSelect={y=>setPart(y,draft.getMonth(),draft.getDate())}/>
          </View>
          <View style={s.actions}><Button label="אישור" onPress={()=>{onChange(localDateOnly(draft));setOpen(false)}} style={s.flex}/><Button label="ביטול" variant="secondary" onPress={()=>setOpen(false)} style={s.flex}/></View>
          {allowEmpty?<Button label="ללא תאריך" variant="secondary" onPress={()=>{onChange('');setOpen(false)}} style={s.empty}/>:null}
        </View>
      </View>
    </Modal>
  </>;
}
function Column({values,selected,text,onSelect,wide=false}:{values:number[];selected:number;text:(n:number)=>string;onSelect:(n:number)=>void;wide?:boolean}) {
  const selectedIndex = Math.max(0, values.indexOf(selected));
  return <ScrollView key={`${values.length}-${selected}`} style={[s.column,wide&&s.wide]} contentOffset={{x:0,y:Math.max(0,selectedIndex*44-88)}} showsVerticalScrollIndicator={false}>{values.map(v=><Pressable key={v} onPress={()=>onSelect(v)} style={[s.row,v===selected&&s.active]}><RtlText style={[s.rowText,v===selected&&s.activeText]}>{text(v)}</RtlText></Pressable>)}</ScrollView>;
}
const s=StyleSheet.create({
  field:{minHeight:52,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center',padding:12},
  fieldText:{fontSize:18,fontWeight:'700',color:colors.textPrimary,textAlign:'center'},
  backdrop:{flex:1,backgroundColor:'#00000055',alignItems:'center',justifyContent:'center',padding:spacing.xl},
  card:{width:'100%',maxWidth:390,backgroundColor:colors.surface,borderRadius:radii.xl,padding:spacing.xl},
  title:{fontSize:18,fontWeight:'800',color:colors.textPrimary,textAlign:'center',marginBottom:spacing.md},
  quick:{flexDirection:'row',gap:spacing.sm},flex:{flex:1},
  columnLabels:{flexDirection:'row',direction:'ltr',justifyContent:'space-around',marginTop:spacing.md},
  columnLabel:{flex:1,textAlign:'center',fontSize:13,fontWeight:'700',color:colors.textSecondary},
  columns:{flexDirection:'row',direction:'ltr',justifyContent:'center',gap:spacing.xs,marginTop:spacing.xs},
  column:{height:220,flex:1,minWidth:0},wide:{flex:1},
  row:{height:44,alignItems:'center',justifyContent:'center',borderRadius:radii.sm},
  active:{backgroundColor:colors.primarySoft},rowText:{fontSize:17,fontWeight:'600',color:colors.textSecondary},
  activeText:{color:colors.primaryDark,fontWeight:'800'},
  actions:{flexDirection:'row',gap:spacing.md,marginTop:spacing.lg},empty:{marginTop:spacing.sm}
});