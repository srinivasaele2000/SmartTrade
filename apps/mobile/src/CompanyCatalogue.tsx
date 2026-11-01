import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiClient, ApiError } from './api';
import { catalogueOptions, cataloguePage, catalogueWrite, emptyProduct, productPayload, variantPayload, type Brand, type OwnerProduct, type ProductForm, type Variant } from './company-catalogue';
import { useResource } from './useResource';

function Button({title,onPress,disabled=false,selected=false}:{title:string;onPress:()=>void;disabled?:boolean;selected?:boolean}) { return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{disabled,selected}} disabled={disabled} onPress={onPress} style={[s.button,selected&&s.selected,disabled&&s.disabled]}><Text style={s.buttonText}>{title}</Text></Pressable>; }
function Field({label,value,onChange,multiline=false,maxLength}:{label:string;value:string;onChange:(value:string)=>void;multiline?:boolean;maxLength?:number}) { return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} maxLength={maxLength} style={[s.input,multiline&&{minHeight:100}]} autoCorrect={false} autoCapitalize="none" /></View>; }
export default function CompanyCatalogue({api,token,writable,expired,refreshCompany}:{api:ApiClient;token:string;writable:boolean;expired:()=>void;refreshCompany?:()=>void}) {
 const scrollRef=useRef<ComponentRef<typeof ScrollView>>(null);
 const [tab,setTab]=useState<'Brands'|'Categories'|'Products'>('Brands');
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState('');
 const options=useResource(useCallback(signal=>catalogueOptions(api,token,signal),[api,token]));
 const products=useResource(useCallback(signal=>cataloguePage<OwnerProduct>(api,token,`/companies/me/catalogue/products?search=${encodeURIComponent(query)}`,page,signal),[api,token,page,query]));
 const data=options.state.status==='ready'?options.state.data:null;
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [brand,setBrand]=useState<Brand|null>(null),[brandName,setBrandName]=useState('');
 const [brandId,setBrandId]=useState<number|null>(null),[categoryId,setCategoryId]=useState<number|null>(null);
 const [selected,setSelected]=useState<OwnerProduct|null>(null),[form,setForm]=useState<ProductForm>(emptyProduct);
 const [variant,setVariant]=useState<Variant|null>(null),[variantForm,setVariantForm]=useState({name:'',sku:'',attributes:'{}',active:true});
 const allowed=writable&&!busy;
 const association=data?.associations.find(item=>item.brand===brandId&&item.category===categoryId);
 async function perform(operation:()=>Promise<unknown>,message:string) {
  setBusy(true);setNotice('');setError('');
  try { await operation();setNotice(message);options.retry();products.retry(); }
  catch(failure) { if(failure instanceof ApiError&&failure.status===401)expired();if(failure instanceof ApiError&&failure.status===403)refreshCompany?.();setError(failure instanceof Error?failure.message:'Catalogue request failed.'); }
  finally {setBusy(false);scrollRef.current?.scrollTo({y:0,animated:true});}
 }
 function editProduct(product:OwnerProduct) {
  setSelected(product);setForm({...product,specifications:JSON.stringify(product.specifications,null,2),catalogue_price:product.catalogue_price??''});
  const link=data?.associations.find(item=>item.id===product.brand_category);setBrandId(link?.brand??null);setCategoryId(link?.category??null);setVariant(null);setVariantForm({name:'',sku:'',attributes:'{}',active:true});setNotice('');setError('');
 }
 function freshProduct(){setSelected(null);setForm(emptyProduct());setVariant(null);setBrandId(null);setCategoryId(null);setVariantForm({name:'',sku:'',attributes:'{}',active:true});}
 const current=selected&&products.state.status==='ready'?products.state.data.results.find(item=>item.id===selected.id)??selected:selected;
 return <ScrollView ref={scrollRef} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
  <Text style={s.kicker}>COMPANY CATALOGUE</Text><Text accessibilityRole="header" style={s.title}>Brands and products</Text>
  <View style={s.wrap}>{(['Brands','Categories','Products'] as const).map(name=><Button key={name} title={name} selected={tab===name} disabled={busy} onPress={()=>{setTab(name);setError('');setNotice('');}} />)}</View>
  {!writable&&<Text style={s.notice}>Read-only: a verified, active company and active account are required for catalogue changes. Company suspension does not delete existing records.</Text>}
  <Button title="Refresh catalogue" disabled={busy} onPress={()=>{setError('');setNotice('');options.retry();products.retry();refreshCompany?.();}} />
  {busy&&<ActivityIndicator accessibilityLabel="Saving catalogue" />}{notice!==''&&<Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>}{error!==''&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  {options.state.status==='loading'&&<ActivityIndicator accessibilityLabel="Loading catalogue options" />}
  {options.state.status==='error'&&<View style={s.card}><Text accessibilityRole="alert" style={s.error}>{options.state.message}</Text><Button title="Retry catalogue options" onPress={options.retry} /></View>}
  {data&&tab==='Brands'&&<>
   <View style={s.card}><Text style={s.heading}>{brand?'Edit brand':'Create brand'}</Text><Field label="Brand name" value={brandName} onChange={setBrandName} maxLength={160} /><Button title={brand?'Save brand':'Create brand'} disabled={!allowed||!brandName.trim()} onPress={()=>void perform(async()=>{await catalogueWrite(api,token,`/companies/me/catalogue/brands${brand?`/${brand.id}`:''}`,{name:brandName.trim()},Boolean(brand));setBrand(null);setBrandName('');},'Brand saved.')} />{brand&&<Button title="Cancel brand editing" onPress={()=>{setBrand(null);setBrandName('');}} />}</View>
   <Text style={s.heading}>Your company-owned brands</Text>{data.brands.length===0&&<Text>No brands yet.</Text>}{data.brands.map(item=><View key={item.id} style={s.card}><Text style={s.heading}>{item.name}</Text><Text>Company: {item.company_name}</Text><Text>Company status: {item.company_verification} / {item.company_activity}</Text><Text>Categories: {item.categories.map(c=>`${c.name}${c.active?'':' (inactive)'}`).join(', ')||'None associated'}</Text><Button title={`Edit brand ${item.name}`} disabled={!allowed} onPress={()=>{setBrand(item);setBrandName(item.name);}} /></View>)}
   <Text style={s.muted}>The existing brand model has no separate active or moderation state. Activation/deactivation is not available; product moderation remains separate.</Text>
  </>}
  {data&&tab==='Categories'&&<View style={s.card}><Text style={s.heading}>Permitted brand categories</Text><Text>Select your brand and an active category. Existing associations are preserved; product associations cannot be moved after creation.</Text>
   <View style={s.wrap}>{data.brands.map(item=><Button key={item.id} title={item.name} selected={brandId===item.id} onPress={()=>setBrandId(item.id)} disabled={busy} />)}</View>
   {data.categories.length===0&&<Text>No active categories are available. Taxonomy is managed by staff.</Text>}<View style={s.wrap}>{data.categories.map(item=><Button key={item.id} title={item.name} selected={categoryId===item.id} onPress={()=>setCategoryId(item.id)} disabled={busy} />)}</View>
   <Button title="Associate brand with category" disabled={!allowed||!brandId||!categoryId||Boolean(association)} onPress={()=>void perform(()=>catalogueWrite(api,token,'/companies/me/catalogue/brand-categories',{brand:brandId,category:categoryId}),'Brand/category association saved.')} />{association&&<Text>This brand/category association already exists.</Text>}
   <Text style={s.label}>Existing associations</Text>{data.associations.length===0&&<Text>No associations yet.</Text>}{data.associations.map(item=><Text key={item.id}>{data.brands.find(b=>b.id===item.brand)?.name??`Brand ${item.brand}`} / {data.categories.find(c=>c.id===item.category)?.name??`Category ${item.category} (not active)`}</Text>)}
  </View>}
  {data&&tab==='Products'&&<>
   <View style={s.card}><Field label="Search your products" value={search} onChange={setSearch} /><Button title="Search company products" disabled={busy} onPress={()=>{setQuery(search.trim());setPage(1);}} /></View>
   {products.state.status==='loading'&&<ActivityIndicator accessibilityLabel="Loading company products" />}{products.state.status==='error'&&<View style={s.card}><Text accessibilityRole="alert">{products.state.message}</Text><Button title="Retry company products" onPress={products.retry} /></View>}
   {products.state.status==='ready'&&<><Text>{products.state.data.count} company products</Text>{products.state.data.results.length===0&&<Text>No products match this search.</Text>}{products.state.data.results.map(item=><View key={item.id} style={s.card}><Text style={s.heading}>{item.name}</Text><Text>{item.brand_name} / {item.category_name}</Text><Text>{item.code} · {item.state} · Moderation: {item.moderation_state}</Text><Text>{item.catalogue_price===null?'Catalogue price not provided':`${item.currency} ${item.catalogue_price}`}</Text><Button title={`Manage product ${item.name}`} disabled={busy} onPress={()=>editProduct(item)} /></View>)}<View style={s.wrap}><Button title="Previous products" disabled={busy||!products.state.data.previous} onPress={()=>setPage(page-1)} /><Text>Page {page}</Text><Button title="Next products" disabled={busy||!products.state.data.next} onPress={()=>setPage(page+1)} /></View></>}
   <Button title="New product" disabled={!allowed} onPress={freshProduct} />
   <View style={s.card}><Text style={s.heading}>{selected?'Edit product':'Create product'}</Text>
    <Text style={s.label}>Company-owned brand</Text><View style={s.wrap}>{data.brands.map(item=><Button key={item.id} title={item.name} disabled={busy||Boolean(selected)} selected={brandId===item.id} onPress={()=>{setBrandId(item.id);setCategoryId(null);}} />)}</View>
    <Text style={s.label}>Associated category</Text><View style={s.wrap}>{data.associations.filter(link=>link.brand===brandId).map(link=><Button key={link.id} title={data.categories.find(c=>c.id===link.category)?.name??`Inactive category ${link.category}`} disabled={busy||Boolean(selected)||!data.categories.some(c=>c.id===link.category)} selected={categoryId===link.category} onPress={()=>setCategoryId(link.category)} />)}</View>
    {(['name','code','description','unit','specifications','catalogue_price','currency'] as const).map(key=><Field key={key} label={{name:'Product name',code:'Product code',description:'Description',unit:'Unit',specifications:'Specifications (JSON object)',catalogue_price:'Company catalogue price (optional)',currency:'Catalogue currency (uppercase)'}[key]} value={form[key]} multiline={key==='description'||key==='specifications'} onChange={value=>setForm(f=>({...f,[key]:value}))} maxLength={key==='name'?200:key==='code'?100:key==='unit'?40:key==='currency'?3:undefined} />)}
    <Text style={s.label}>Publication</Text><View style={s.wrap}>{(['DRAFT','PUBLISHED','ARCHIVED'] as const).map(state=><Button key={state} title={state} selected={form.state===state} disabled={busy} onPress={()=>setForm(f=>({...f,state}))} />)}</View>
    <Text>Moderation: {current?.moderation_state??'VISIBLE on creation'}. Company edits cannot override admin moderation.</Text>
    <Button title={selected?'Save product':'Create product'} disabled={!allowed||!association} onPress={()=>void perform(async()=>{const payload=productPayload(form,selected?undefined:association?.id);const value=await catalogueWrite<OwnerProduct>(api,token,`/companies/me/catalogue/products${selected?`/${selected.id}`:''}`,payload,Boolean(selected));setSelected(value);},'Product saved. Publication remains subject to company eligibility and admin moderation.')} />
    <Text style={s.muted}>Product images are not supported by the current API. No upload endpoint or public image URL has been invented. Catalogue prices are independent of dealer selling prices.</Text>
   </View>
   {current&&<View style={s.card}><Text style={s.heading}>Variants and SKUs</Text><Text>SKUs must be unique within this product. The owning product cannot be changed.</Text>{(current.variants??[]).length===0&&<Text>No variants yet.</Text>}{(current.variants??[]).map(item=><Button key={item.id} title={`Edit SKU ${item.sku}`} disabled={busy} onPress={()=>{setVariant(item);setVariantForm({name:item.name,sku:item.sku,attributes:JSON.stringify(item.attributes,null,2),active:item.active});}} />)}
    <Field label="Variant name" value={variantForm.name} maxLength={160} onChange={name=>setVariantForm(f=>({...f,name}))} /><Field label="SKU" value={variantForm.sku} maxLength={100} onChange={sku=>setVariantForm(f=>({...f,sku}))} /><Field label="Variant attributes (JSON object)" value={variantForm.attributes} multiline onChange={attributes=>setVariantForm(f=>({...f,attributes}))} />
    <Button title={variantForm.active?'Variant active':'Variant inactive'} selected={variantForm.active} disabled={busy} onPress={()=>setVariantForm(f=>({...f,active:!f.active}))} />
    <Button title={variant?'Save variant':'Create variant'} disabled={!allowed} onPress={()=>void perform(async()=>{await catalogueWrite(api,token,`/companies/me/catalogue/products/${current.id}/variants${variant?`/${variant.id}`:''}`,variantPayload(variantForm),Boolean(variant));setVariant(null);setVariantForm({name:'',sku:'',attributes:'{}',active:true});},'Variant saved.')} />{variant&&<Button title="New variant" onPress={()=>{setVariant(null);setVariantForm({name:'',sku:'',attributes:'{}',active:true});}} />}
   </View>}
  </>}
 </ScrollView>;
}
const s=StyleSheet.create({content:{padding:20,gap:14,paddingBottom:80},kicker:{fontWeight:'800',color:'#087f5b',letterSpacing:1},title:{fontSize:28,fontWeight:'800',color:'#17392d'},heading:{fontSize:20,fontWeight:'700',color:'#17392d'},label:{fontWeight:'700',color:'#294b3a'},card:{padding:18,gap:14,borderRadius:16,borderWidth:1,borderColor:'#dce7e0',backgroundColor:'#fff'},field:{gap:7},input:{minHeight:48,borderWidth:1,borderColor:'#9fb7aa',padding:12,borderRadius:10,color:'#17392d',fontSize:16},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},button:{padding:13,minHeight:48,borderRadius:9,backgroundColor:'#e3f2e9'},buttonText:{fontWeight:'700',color:'#125335'},selected:{backgroundColor:'#bde5ce',borderWidth:1,borderColor:'#176c46'},disabled:{opacity:.45},notice:{padding:12,backgroundColor:'#edf7f0',color:'#294b3a',lineHeight:22},error:{color:'#9c2820',lineHeight:22},muted:{color:'#52675c',lineHeight:22}});
