unit HOSxPPCUAccount2PersonANCLabEntryFormUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, cxGraphics, cxLookAndFeels, cxLookAndFeelPainters, Menus,
  dxSkinsCore, dxSkinsDefaultPainters, StdCtrls, cxButtons, ExtCtrls,
  JvExControls, JvNavigationPane, cxControls, cxContainer, cxEdit, cxGroupBox,
  DB, DBClient, cxTextEdit, cxDBEdit, cxLabel, cxMaskEdit, cxDropDownEdit,
  cxLookupEdit, cxDBLookupEdit, cxDBLookupComboBox, cxCheckBox;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}


type
  THOSxPPCUAccount2PersonANCLabEntryForm = class(TForm)
    JvNavPanelHeader1: TJvNavPanelHeader;
    Panel2: TPanel;
    CloseButton: TcxButton;
    SaveButton: TcxButton;
    DeleteButton: TcxButton;
    LogViewButton: TcxButton;
    cxGroupBox1: TcxGroupBox;
    PersonANCLabCDS: TClientDataSet;
    PersonANCLabDS: TDataSource;
    cxLabel1: TcxLabel;
    cxDBLookupComboBox1: TcxDBLookupComboBox;
    cxLabel2: TcxLabel;
    cxDBTextEdit1: TcxDBTextEdit;
    cxDBCheckBox1: TcxDBCheckBox;
  
   
    procedure PersonANCLabCDSBeforePost(DataSet: TDataSet);
    procedure CloseButtonClick(Sender: TObject);
    procedure SaveButtonClick(Sender: TObject);
    procedure DeleteButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
    procedure PersonANCLabCDSNewRecord(DataSet: TDataSet);
  private
    FPersonANCLabID: Integer;
    FPersonANCServiceID: integer;
    procedure SetPersonANCLabID(const Value: Integer);
    procedure RefreshData;
    procedure DoSaveData;
    procedure DoDeleteData;
    procedure SetPersonANCServiceID(const Value: integer);
    { Private declarations }
  public
    { Public declarations }
    property PersonANCServiceID : integer read FPersonANCServiceID write SetPersonANCServiceID;
    property PersonANCLabID: Integer read FPersonANCLabID write SetPersonANCLabID;
    class procedure DoShowForm(xPersonANCServiceID,xPersonANCLabID:Integer);
  end;

var
  HOSxPPCUAccount2PersonANCLabEntryForm: THOSxPPCUAccount2PersonANCLabEntryForm;

implementation

uses HOSxPDMU, BMSApplicationUtil,HOSxPPCUAccount2DataModuleUnit;

{$R *.dfm}
{ THOSxPSystemSettingIPDBedEntryForm }

procedure THOSxPPCUAccount2PersonANCLabEntryForm.PersonANCLabCDSBeforePost
  (DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    DataSet.FieldByName('person_anc_lab_id').AsInteger := FPersonANCLabID;
  end;

  dataset.FieldByName('person_anc_service_id').AsInteger:=FPersonANCServiceID;

end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.PersonANCLabCDSNewRecord(
  DataSet: TDataSet);
begin
  dataset.FieldByName('lab_result_normal').AsString:='Y';
end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.SaveButtonClick(Sender: TObject);
begin
  DoSaveData;
  Close;
end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.DeleteButtonClick(Sender: TObject);
begin
  if messagedlg('Please confirm delete data ?',mtconfirmation,[mbyes,mbno],0)<>mryes then
  exit;
  DoDeleteData;
  Close;
end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.CloseButtonClick(Sender: TObject);
begin
  Close;
end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.LogViewButtonClick(
  Sender: TObject);
begin
   SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_lab"',
    inttostr(FPersonANCLabID)]);
end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.DoDeleteData;
begin
   if (PersonANCLabCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCLabCDS.cancel;

  end;

  if PersonANCLabCDS.recordcount>0 then
  PersonANCLabCDS.delete;

  if PersonANCLabCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCLabCDS, 'select * from person_anc_lab where person_anc_lab_id = ' +
      inttostr(FPersonANCLabID) , '', '', '');
    PersonANCLabCDS.MergeChangeLog;
  end;
end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.DoSaveData;
begin
  if (PersonANCLabCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCLabCDS.post;

  end;

  if PersonANCLabCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCLabCDS, 'select * from person_anc_lab where person_anc_lab_id = ' +
      inttostr(FPersonANCLabID) , '', '', '');
    PersonANCLabCDS.MergeChangeLog;
  end;
end;

class procedure THOSxPPCUAccount2PersonANCLabEntryForm.DoShowForm(xPersonANCServiceID,xPersonANCLabID: Integer);
var FHOSxPPCUAccount2PersonANCLabEntryForm:THOSxPPCUAccount2PersonANCLabEntryForm;
begin
  FHOSxPPCUAccount2PersonANCLabEntryForm:=THOSxPPCUAccount2PersonANCLabEntryForm.Create(application);
  try
  FHOSxPPCUAccount2PersonANCLabEntryForm.PersonANCServiceID:=xPersonANCServiceID;
  FHOSxPPCUAccount2PersonANCLabEntryForm.PersonANCLabID:=xPersonANCLabID;
  FHOSxPPCUAccount2PersonANCLabEntryForm.ShowModal;
  finally
     FHOSxPPCUAccount2PersonANCLabEntryForm.Free;
  end;

end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.RefreshData;
begin

  if not assigned(HOSxPPCUAccount2DataModule) then
  HOSxPPCUAccount2DataModule:=THOSxPPCUAccount2DataModule.Create(application);

  PersonANCLabCDS.Data := hosxp_getdataset('select * from person_anc_lab where person_anc_lab_id = ' +
    inttostr(FPersonANCLabID) );
end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.SetPersonANCLabID(const Value: Integer);
begin
  FPersonANCLabID := Value;
  if FPersonANCLabID = 0 then
  begin
   repeat
    FPersonANCLabID := getserialnumber('person_anc_lab_id');  //GetNewCodeFromTable('person_anc_lab', 'person_anc_lab_id', '', '001', 3);
   until getsqldata('select count(*) as cc from person_anc_lab where person_anc_lab_id = '+inttostr(FPersonANCLabID))=0;
  end;
  RefreshData;
end;

procedure THOSxPPCUAccount2PersonANCLabEntryForm.SetPersonANCServiceID(
  const Value: integer);
begin
  FPersonANCServiceID := Value;
end;

end.
