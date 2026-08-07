unit HOSxPPCUAccount2OtherPrecareEntryFormUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, cxGraphics, cxLookAndFeels, cxLookAndFeelPainters, Menus,
  dxSkinsCore, dxSkinsDefaultPainters, StdCtrls, cxButtons, ExtCtrls,
  JvExControls, JvNavigationPane, cxControls, cxContainer, cxEdit, cxGroupBox,
  DB, DBClient, cxTextEdit, cxDBEdit, cxLabel, cxMaskEdit, cxDropDownEdit,
  cxLookupEdit, cxDBLookupEdit, cxDBLookupComboBox, cxCalendar, cxSpinEdit,
  cxMemo;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}


type
  THOSxPPCUAccount2OtherPrecareEntryForm = class(TForm)
    JvNavPanelHeader1: TJvNavPanelHeader;
    Panel2: TPanel;
    CloseButton: TcxButton;
    SaveButton: TcxButton;
    DeleteButton: TcxButton;
    LogViewButton: TcxButton;
    cxGroupBox1: TcxGroupBox;
    PersonANCOtherPrecareCDS: TClientDataSet;
    PersonANCOtherPrecareDS: TDataSource;
    cxLabel1: TcxLabel;
    cxDBDateEdit1: TcxDBDateEdit;
    cxLabel2: TcxLabel;
    cxDBTextEdit1: TcxDBTextEdit;
    cxButton1: TcxButton;
    HospitalNameEdit: TcxTextEdit;
    cxLabel3: TcxLabel;
    cxDBSpinEdit1: TcxDBSpinEdit;
    cxLabel4: TcxLabel;
    cxDBLookupComboBox1: TcxDBLookupComboBox;
    ANCResultTypeCDS: TClientDataSet;
    ANCResultTypeDS: TDataSource;
    cxLabel5: TcxLabel;
    cxDBMemo1: TcxDBMemo;
  
   
    procedure PersonANCOtherPrecareCDSBeforePost(DataSet: TDataSet);
    procedure CloseButtonClick(Sender: TObject);
    procedure SaveButtonClick(Sender: TObject);
    procedure DeleteButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
    procedure cxDBTextEdit1PropertiesEditValueChanged(Sender: TObject);
    procedure FormCreate(Sender: TObject);
    procedure cxButton1Click(Sender: TObject);
  private
    FPersonANCOtherPrecareID: Integer;
    FPersonANCID: integer;
    procedure SetPersonANCOtherPrecareID(const Value: Integer);
    procedure RefreshData;
    procedure DoSaveData;
    procedure DoDeleteData;
    procedure SetPersonANCID(const Value: integer);
    { Private declarations }
  public
    { Public declarations }
     property PersonANCID : integer read FPersonANCID write SetPersonANCID;
    property PersonANCOtherPrecareID: Integer read FPersonANCOtherPrecareID write SetPersonANCOtherPrecareID;
    class procedure DoShowForm(xPersonANCID,xPersonANCOtherPrecareID:Integer);
  end;

var
  HOSxPPCUAccount2OtherPrecareEntryForm: THOSxPPCUAccount2OtherPrecareEntryForm;

implementation

uses HOSxPDMU, BMSApplicationUtil;

{$R *.dfm}
{ THOSxPSystemSettingIPDBedEntryForm }

procedure THOSxPPCUAccount2OtherPrecareEntryForm.PersonANCOtherPrecareCDSBeforePost
  (DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    DataSet.FieldByName('person_anc_other_precare_id').AsInteger := FPersonANCOtherPrecareID;
  end;

  dataset.FieldByName('person_anc_id').AsInteger:=FPersonANCID;

end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.SaveButtonClick(Sender: TObject);
begin
  DoSaveData;
  Close;
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.cxButton1Click(
  Sender: TObject);
var s:string;
begin
  s:=ShowFindHospitalCodeDialog;
  if s<>'' then
  begin
    if (PersonANCOtherPrecareCDS.State in [dsbrowse]) then
    begin
      if PersonANCOtherPrecareCDS.RecordCount=0 then
         PersonANCOtherPrecareCDS.Append else PersonANCOtherPrecareCDS.Edit;
    end;

    PersonANCOtherPrecareCDS.FieldByName('precare_hospcode').AsString:=s;

  end;
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.cxDBTextEdit1PropertiesEditValueChanged(
  Sender: TObject);
begin
  hospitalnameedit.Text:= VarToStr( GetSQLData('select concat(hosptype," ",name) as hospital_name from hospcode where hospcode="'+
    vartostr(cxDBTextEdit1.EditValue)+'"') );
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.DeleteButtonClick(Sender: TObject);
begin
  if messagedlg('Please confirm delete data ?',mtconfirmation,[mbyes,mbno],0)<>mryes then
  exit;
  DoDeleteData;
  Close;
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.CloseButtonClick(Sender: TObject);
begin
  Close;
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.LogViewButtonClick(
  Sender: TObject);
begin
   SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_other_precare"',
    inttostr(FPersonANCOtherPrecareID)]);
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.DoDeleteData;
begin
   if (PersonANCOtherPrecareCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCOtherPrecareCDS.cancel;

  end;

  if PersonANCOtherPrecareCDS.recordcount>0 then
  PersonANCOtherPrecareCDS.delete;

  if PersonANCOtherPrecareCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCOtherPrecareCDS, 'select * from person_anc_other_precare where person_anc_other_precare_id = ' +
      inttostr(FPersonANCOtherPrecareID) , '', '', '');
    PersonANCOtherPrecareCDS.MergeChangeLog;
  end;
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.DoSaveData;
begin
  if (PersonANCOtherPrecareCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCOtherPrecareCDS.post;

  end;

  if PersonANCOtherPrecareCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCOtherPrecareCDS, 'select * from person_anc_other_precare where person_anc_other_precare_id = ' +
      inttostr(FPersonANCOtherPrecareID) , '', '', '');
    PersonANCOtherPrecareCDS.MergeChangeLog;
  end;
end;

class procedure THOSxPPCUAccount2OtherPrecareEntryForm.DoShowForm(xPersonANCID,xPersonANCOtherPrecareID: Integer);
var FHOSxPPCUAccount2OtherPrecareEntryForm:THOSxPPCUAccount2OtherPrecareEntryForm;
begin
  FHOSxPPCUAccount2OtherPrecareEntryForm:=THOSxPPCUAccount2OtherPrecareEntryForm.Create(application);
  try
  FHOSxPPCUAccount2OtherPrecareEntryForm.PersonANCID:=xPersonANCID;
  FHOSxPPCUAccount2OtherPrecareEntryForm.PersonANCOtherPrecareID:=xPersonANCOtherPrecareID;
  FHOSxPPCUAccount2OtherPrecareEntryForm.ShowModal;
  finally
     FHOSxPPCUAccount2OtherPrecareEntryForm.Free;
  end;

end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.FormCreate(Sender: TObject);
begin
  ancresulttypecds.data:=hosxp_getdataset('select * from anc_result_type');
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.RefreshData;
begin

  PersonANCOtherPrecareCDS.Data := hosxp_getdataset('select * from person_anc_other_precare where person_anc_other_precare_id = ' +
    inttostr(FPersonANCOtherPrecareID) );
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.SetPersonANCID(
  const Value: integer);
begin
  FPersonANCID := Value;
end;

procedure THOSxPPCUAccount2OtherPrecareEntryForm.SetPersonANCOtherPrecareID(const Value: Integer);
begin
  FPersonANCOtherPrecareID := Value;
  if FPersonANCOtherPrecareID = 0 then
  begin
   repeat
    FPersonANCOtherPrecareID := getserialnumber('person_anc_other_precare_id');  //GetNewCodeFromTable('person_anc_other_precare', 'person_anc_other_precare_id', '', '001', 3);
   until getsqldata('select count(*) as cc from person_anc_other_precare where person_anc_other_precare_id = '+inttostr(FPersonANCOtherPrecareID))=0;
  end;
  RefreshData;
end;

end.
