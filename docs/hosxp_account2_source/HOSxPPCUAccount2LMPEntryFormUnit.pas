unit HOSxPPCUAccount2LMPEntryFormUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, cxGraphics, cxControls, cxLookAndFeels, cxLookAndFeelPainters, cxContainer, cxEdit, Menus, StdCtrls, cxButtons, cxTextEdit, cxMaskEdit,
  cxSpinEdit,  cxGroupBox, ExtCtrls, JvExControls, JvNavigationPane,  cxLabel;

type
  THOSxPPCUAccount2LMPEntryForm = class(TForm)
    JvNavPanelHeader1: TJvNavPanelHeader;
    Panel1: TPanel;
    cxGroupBox1: TcxGroupBox;
    cxSpinEdit1: TcxSpinEdit;
    cxSpinEdit2: TcxSpinEdit;
    cxButton1: TcxButton;
    cxLabel1: TcxLabel;
    cxLabel2: TcxLabel;
    procedure cxButton1Click(Sender: TObject);
  private
    { Private declarations }
  public
    { Public declarations }
  end;

var
  HOSxPPCUAccount2LMPEntryForm: THOSxPPCUAccount2LMPEntryForm;

implementation

{$R *.dfm}

procedure THOSxPPCUAccount2LMPEntryForm.cxButton1Click(Sender: TObject);
begin
  close;
  modalresult:=mrok;
end;

end.
