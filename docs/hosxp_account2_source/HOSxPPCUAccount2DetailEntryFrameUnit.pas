unit HOSxPPCUAccount2DetailEntryFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms, 
  Dialogs, DB, DBClient, cxGraphics, cxControls, cxLookAndFeels,
  cxLookAndFeelPainters, cxContainer, cxEdit, dxSkinsCore,
  dxSkinsDefaultPainters, Menus, cxCheckBox, cxDBEdit, cxLookupEdit,
  cxDBLookupEdit, cxDBLookupComboBox, StdCtrls, cxButtons, cxDropDownEdit,
  cxTextEdit, cxMaskEdit, cxCalendar, cxGroupBox, cxMemo, cxLabel,
  dxSkinscxPCPainter, cxPC, cxSpinEdit, dxLayoutcxEditAdapters,
  dxLayoutContainer, dxLayoutLookAndFeels, cxClasses, dxLayoutControl,
  dxBarBuiltInMenu;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}
type
  THOSxPPCUAccount2DetailEntryFrame = class(TFrame)
    PersonANCCDS: TClientDataSet;
    PersonANCDS: TDataSource;
    dxLayoutControl1Group_Root: TdxLayoutGroup;
    dxLayoutControl1: TdxLayoutControl;
    dxLayoutLookAndFeelList1: TdxLayoutLookAndFeelList;
    dxLayoutSkinLookAndFeel1: TdxLayoutSkinLookAndFeel;
    dxLayoutControl1Item1: TdxLayoutItem;
    cxGroupBox1: TcxGroupBox;
    Label12: TcxLabel;
    Label13: TcxLabel;
    Label14: TcxLabel;
    Label20: TcxLabel;
    Label29: TcxLabel;
    Label25: TcxLabel;
    Label22: TcxLabel;
    Label46: TcxLabel;
    Label28: TcxLabel;
    cxDBDateEdit1: TcxDBDateEdit;
    cxDBComboBox1: TcxDBComboBox;
    cxDBTextEdit14: TcxDBTextEdit;
    cxButton6: TcxButton;
    cxDBTextEdit15: TcxDBSpinEdit;
    cxDBLookupComboBox5: TcxDBLookupComboBox;
    cxDBDateEdit4: TcxDBDateEdit;
    cxButton10: TcxButton;
    cxDBDateEdit3: TcxDBDateEdit;
    cxDBDateEdit11: TcxDBDateEdit;
    cxDBDateEdit5: TcxDBDateEdit;
    cxDBCheckBox5: TcxDBCheckBox;
    cxDBCheckBox1: TcxDBCheckBox;
    dxLayoutControl1Item2: TdxLayoutItem;
    cxPageControl1: TcxPageControl;
    cxTabSheet2: TcxTabSheet;
    cxGroupBox6: TcxGroupBox;
    Label38: TLabel;
    Label39: TLabel;
    Label41: TLabel;
    Label42: TLabel;
    Label43: TLabel;
    Label45: TLabel;
    Label44: TLabel;
    cxDBSpinEdit3: TcxDBSpinEdit;
    cxDBDateEdit7: TcxDBDateEdit;
    cxDBDateEdit8: TcxDBDateEdit;
    cxDBDateEdit9: TcxDBDateEdit;
    cxDBCheckBox4: TcxDBCheckBox;
    cxDBDateEdit10: TcxDBDateEdit;
    cxDBLookupComboBox16: TcxDBLookupComboBox;
    cxGroupBox4: TcxGroupBox;
    Label23: TLabel;
    Label30: TLabel;
    Label33: TLabel;
    Label35: TLabel;
    Label37: TLabel;
    Label48: TLabel;
    cxDBLookupComboBox6: TcxDBLookupComboBox;
    cxDBLookupComboBox8: TcxDBLookupComboBox;
    cxDBLookupComboBox11: TcxDBLookupComboBox;
    cxDBLookupComboBox13: TcxDBLookupComboBox;
    cxDBLookupComboBox15: TcxDBLookupComboBox;
    cxDBLookupComboBox17: TcxDBLookupComboBox;
    cxDBLookupComboBox18: TcxDBLookupComboBox;
    cxGroupBox5: TcxGroupBox;
    Label24: TLabel;
    Label31: TLabel;
    Label32: TLabel;
    Label34: TLabel;
    Label36: TLabel;
    Label49: TLabel;
    cxDBLookupComboBox7: TcxDBLookupComboBox;
    cxDBLookupComboBox9: TcxDBLookupComboBox;
    cxDBLookupComboBox10: TcxDBLookupComboBox;
    cxDBLookupComboBox12: TcxDBLookupComboBox;
    cxDBLookupComboBox14: TcxDBLookupComboBox;
    cxDBLookupComboBox19: TcxDBLookupComboBox;
    cxTabSheet1: TcxTabSheet;
    cxGroupBox2: TcxGroupBox;
    cxDBMemo1: TcxDBMemo;
    cxButton1: TcxButton;
    cxTabSheet3: TcxTabSheet;
    cxGroupBox3: TcxGroupBox;
    cxLabel1: TcxLabel;
    cxDBLookupComboBox1: TcxDBLookupComboBox;
    cxButton2: TcxButton;
    cxLabel2: TcxLabel;
    cxDBMemo2: TcxDBMemo;
    procedure cxButton6Click(Sender: TObject);
    procedure cxButton10Click(Sender: TObject);
    procedure PersonANCCDSBeforePost(DataSet: TDataSet);
    procedure PersonANCCDSNewRecord(DataSet: TDataSet);
    procedure cxButton1Click(Sender: TObject);
    procedure cxDBDateEdit4PropertiesCloseUp(Sender: TObject);
    procedure cxDBTextEdit15PropertiesEditValueChanged(Sender: TObject);
  private
    FPersonANCID: Integer;
    FPersonID: Integer;

  //  HOSxPPCUAccount2DataModule: THOSxPPCUAccount2DataModule;
    procedure SetPersonANCID(const Value: Integer);
    procedure SetPersonID(const Value: Integer);
    { Private declarations }
  public
    procedure RefreshData;
    procedure DoSaveData;
    procedure DoDeleteData;
    { Public declarations }
    property PersonID : Integer read FPersonID write SetPersonID;
    property PersonANCID: Integer read FPersonANCID write SetPersonANCID;
    function GetPersonANCCDS:TClientDataset;
  end;

implementation
uses HOSxPDMU,BMSApplicationUtil,ThaiDate,HOSxPPCUAccount2LMPEntryFormUnit,HOSxPPCUAccount2DataModuleUnit;

{$R *.dfm}

{ THOSxPPCUAccount2DetailEntryFrame }

procedure THOSxPPCUAccount2DetailEntryFrame.cxButton10Click(Sender: TObject);
var
  s: string;
  i,i1,i2: integer;

  FHOSxPPCUAccount2LMPEntryForm:THOSxPPCUAccount2LMPEntryForm;
begin
  s := '0';

  FHOSxPPCUAccount2LMPEntryForm:=THOSxPPCUAccount2LMPEntryForm.Create(application);
  try
    FHOSxPPCUAccount2LMPEntryForm.ShowModal;
    if FHOSxPPCUAccount2LMPEntryForm.ModalResult<>mrok then
    begin
      exit;
    end;

    i1:=  FHOSxPPCUAccount2LMPEntryForm.cxSpinEdit1.Value;
    i2:=  FHOSxPPCUAccount2LMPEntryForm.cxSpinEdit2.Value;


  finally
    FHOSxPPCUAccount2LMPEntryForm.Free;
  end;

 // if not inputquery('ใส่ค่า GA', 'ค่า GA', s) then
   // exit;

  i := (i1*7)+i2;

  //i := i * 7;

  if (PersonAncCDS.state in [dsbrowse]) then
  begin
    if PersonANCCds.recordcount = 0 then
      personanccds.append
    else
      personanccds.edit;
  end;

  personanccds.fieldbyname('lmp').asdatetime := getserverdate - i;
  personanccds.fieldbyname('lmp_from_us').asstring := 'Y';

  personanccds.fieldbyname('edc').asdatetime :=personanccds.fieldbyname('lmp').asdatetime+280;

end;
procedure THOSxPPCUAccount2DetailEntryFrame.cxButton1Click(Sender: TObject);
var s:string;
begin
  s:=ShowFindDoctorCodeDialog;
  if s<>'' then
  begin
    if (PersonANCCDS.State in [dsbrowse]) then
    begin
      if PersonANCCDS.RecordCount=0 then
         PersonANCCDS.Append else PersonANCCDS.Edit;
    end;

    PersonANCCDS.FieldByName('anc_register_staff').AsString:=vartostr(getsqldata('select name from doctor where code="'+s+'"'));

  end;
end;

procedure THOSxPPCUAccount2DetailEntryFrame.cxButton6Click(Sender: TObject);
begin
  if personanccds.fieldbyname('person_anc_no').asinteger = 0 then
  begin
    if (personanccds.state in [dsbrowse]) then
      personanccds.edit;
    personanccds.fieldbyname('person_anc_no').asinteger :=
      GetSerialNumber('person_anc_no_year_' +
      formatthaidate('eeee', date));

  end;
end;

procedure THOSxPPCUAccount2DetailEntryFrame.cxDBDateEdit4PropertiesCloseUp(
  Sender: TObject);
begin
   cxDBDateEdit4.PostEditValue;
   personanccds.fieldbyname('edc').asdatetime :=personanccds.fieldbyname('lmp').asdatetime+280;
end;

procedure THOSxPPCUAccount2DetailEntryFrame.cxDBTextEdit15PropertiesEditValueChanged(
  Sender: TObject);
var i:integer;
begin
   try
     i:=cxdbtextedit15.EditValue;
   except
     i:=0;

   end;

   cxDBTextEdit15.Style.Color:=clWindow;

   if i>1 then
   begin
     if getsqldata('select count(*) as cc from person_anc where person_id = '+inttostr(FPersonID)+' and preg_no='+
       inttostr(i-1))=0

      then
      begin
          cxDBTextEdit15.Style.Color:=$00B9B9FF;
      end else
      begin
          cxDBTextEdit15.Style.Color:= $00C6FFC6;
      end;

   end;
end;

procedure THOSxPPCUAccount2DetailEntryFrame.DoDeleteData;
begin
  if (PersonANCCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCCDS.cancel;

  end;

  if PersonANCCDS.recordcount>0 then
  PersonANCCDS.delete;

  if PersonANCCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCCDS, 'select * from person_anc where person_anc_id = ' +
      inttostr(FPersonANCID) , '', '', '');
    PersonANCCDS.MergeChangeLog;
  end;
end;

procedure THOSxPPCUAccount2DetailEntryFrame.DoSaveData;
begin

  if strtointdef(vartostr(getsqldata('select sex from person where person_id = '+inttostr(FPersonID))),0)<>2 then
  begin
    showmessage('เพศ ไม่ถูกต้อง');
    abort;
  end;


  if vartostr(getsqldata('select sex from person where person_id = '+inttostr(FPersonID)))<>'2' then
  begin
    showmessage('เพศไม่ถูกต้อง');
    abort;
  end;

  if PersonANCCDS.FieldByName('preg_no').AsInteger<=0 then
  begin
    showmessage('ครรภ์ที่ ไม่ถูกต้อง');
    abort;
  end;

   if PersonANCCDS.FieldByName('preg_no').AsInteger>20 then
  begin
    showmessage('ครรภ์ที่ ไม่ถูกต้อง');
    abort;
  end;


   if (PersonANCCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCCDS.post;

  end;

  PersonANCCDS.edit;
  if PersonANCCDS.FieldByName('edc').AsDateTime<100 then
     PersonANCCDS.FieldByName('edc').asvariant:=null;
  if PersonANCCDS.FieldByName('lmp').AsDateTime<100 then
     PersonANCCDS.FieldByName('lmp').asvariant:=null;


  PersonANCCDS.post;

  if PersonANCCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCCDS, 'select * from person_anc where person_anc_id = ' +
      inttostr(FPersonANCID) , '', '', '');
    PersonANCCDS.MergeChangeLog;
  end;
end;

function THOSxPPCUAccount2DetailEntryFrame.GetPersonANCCDS: TClientDataset;
begin
  result:=self.PersonANCCDS;
end;

procedure THOSxPPCUAccount2DetailEntryFrame.PersonANCCDSBeforePost(
  DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    DataSet.FieldByName('person_anc_id').AsInteger := FPersonANCID;
  end;
  dataset.FieldByName('person_id').AsInteger:=FPersonID;

  if dataset.FieldByName('discharge').AsString='' then
    dataset.FieldByName('discharge').AsString:='N';

    if dataset.fieldbyname('lmp').asdatetime>0 then

    dataset.fieldbyname('edc').asdatetime :=dataset.fieldbyname('lmp').asdatetime+280;

    dataset.FieldByName('last_update').AsDateTime:=getserverdatetime;

end;

procedure THOSxPPCUAccount2DetailEntryFrame.PersonANCCDSNewRecord(
  DataSet: TDataSet);
begin
  dataset.FieldByName('person_id').AsInteger:=FPersonID;
  dataset.FieldByName('preg_no').AsInteger:=1;
  dataset.FieldByName('discharge').AsString:='N';
  dataset.FieldByName('anc_register_staff').AsString:=
   vartostr(getsqldata('select name from doctor where code="'+fdoctor_code+'"'));
end;

procedure THOSxPPCUAccount2DetailEntryFrame.RefreshData;
begin

  if not assigned(HOSxPPCUAccount2DataModule) then
  HOSxPPCUAccount2DataModule:=THOSxPPCUAccount2DataModule.Create(application);

  PersonANCCDS.Data := hosxp_getdataset('select * from person_anc where person_anc_id = ' +
    inttostr(FPersonANCID) );
end;

procedure THOSxPPCUAccount2DetailEntryFrame.SetPersonANCID(
  const Value: Integer);
begin
  FPersonANCID := Value;
  if FPersonANCID = 0 then
  begin
   repeat
    FPersonANCID := getserialnumber('person_anc_id');  //GetNewCodeFromTable('person_anc', 'person_anc_id', '', '001', 3);
   until getsqldata('select count(*) as cc from person_anc where person_anc_id = '+inttostr(FPersonANCID))=0;
  end;
  RefreshData;
end;

procedure THOSxPPCUAccount2DetailEntryFrame.SetPersonID(const Value: Integer);
begin
  FPersonID := Value;
end;

end.
